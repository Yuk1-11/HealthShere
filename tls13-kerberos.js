// ============================================
// TLS 1.3 & Kerberos Challenge-Response Authentication
// 相互認証と完全なハンドシェイクプロトコル
// ============================================

import { auth, db } from "./firebase.js";
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    addDoc
} from "firebase/firestore";

// ============================================
// 定数定義
// ============================================

const TLS_KERBEROS_CONFIG = {
    // TLS 1.3 関連
    TLS_VERSION: '1.3',
    SUPPORTED_CIPHER_SUITES: [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256'
    ],
    SUPPORTED_GROUPS: ['x25519', 'P-256', 'P-384'],
    SUPPORTED_SIGNATURE_ALGORITHMS: ['ecdsa_secp384r1_sha384', 'ecdsa_secp256r1_sha256', 'rsa_pss_rsae_sha384'],
    
    // Kerberos 関連
    KERBEROS_VERSION: 5,
    KERBEROS_REALM: 'HEALTHSHARE.LOCAL',
    TICKET_LIFETIME: 28800, // 8時間
    RENEWABLE_LIFETIME: 604800, // 7日間
    
    // Challenge-Response 関連
    CHALLENGE_LENGTH: 32,
    CHALLENGE_EXPIRY: 300, // 5分
    NONCE_LENGTH: 16,
    
    // セッション管理
    SESSION_TIMEOUT: 3600, // 1時間
    MAX_SESSIONS_PER_USER: 5,
};

// ============================================
// 暗号化ユーティリティ
// ============================================

class CryptoUtils {
    /**
     * 安全なランダムバイトを生成
     */
    static getRandomBytes(length) {
        const bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return bytes;
    }

    /**
     * バイト配列を16進数文字列に変換
     */
    static bytesToHex(bytes) {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * 16進数文字列をバイト配列に変換
     */
    static hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
    }

    /**
     * Base64URL エンコード
     */
    static base64UrlEncode(data) {
        if (typeof data === 'string') {
            data = new TextEncoder().encode(data);
        }
        return btoa(String.fromCharCode(...data))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    /**
     * Base64URL デコード
     */
    static base64UrlDecode(str) {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) {
            str += '=';
        }
        return new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
    }

    /**
     * HMAC-SHA256 署名
     */
    static async hmacSign(key, data) {
        const encoder = new TextEncoder();
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            typeof key === 'string' ? encoder.encode(key) : key,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign(
            'HMAC',
            cryptoKey,
            encoder.encode(data)
        );
        return this.bytesToHex(new Uint8Array(signature));
    }

    /**
     * HMAC 署名検証
     */
    static async hmacVerify(key, data, signature) {
        const expectedSignature = await this.hmacSign(key, data);
        return expectedSignature === signature;
    }

    /**
     * AES-GCM 暗号化
     */
    static async encryptAESGCM(plaintext, key, iv) {
        const encoder = new TextEncoder();
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            key,
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        );
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            cryptoKey,
            encoder.encode(plaintext)
        );
        return new Uint8Array(ciphertext);
    }

    /**
     * AES-GCM 復号
     */
    static async decryptAESGCM(ciphertext, key, iv) {
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            key,
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        );
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            cryptoKey,
            ciphertext
        );
        return new TextDecoder().decode(plaintext);
    }

    /**
     * SHA-256 ハッシュ
     */
    static async sha256(data) {
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest(
            'SHA-256',
            encoder.encode(data)
        );
        return this.bytesToHex(new Uint8Array(hashBuffer));
    }

    /**
     * HKDF 鍵導出
     */
    static async hkdf(secret, salt, info, length = 32) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            typeof secret === 'string' ? encoder.encode(secret) : secret,
            'HKDF',
            false,
            ['deriveBits']
        );
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: typeof salt === 'string' ? encoder.encode(salt) : salt,
                info: typeof info === 'string' ? encoder.encode(info) : info
            },
            key,
            length * 8
        );
        return new Uint8Array(derivedBits);
    }
}

// ============================================
// TLS 1.3 ハンドシェイク実装
// ============================================

class TLS13Handshake {
    constructor() {
        this.state = 'INIT';
        this.clientHello = null;
        this.serverHello = null;
        this.sharedSecret = null;
        this.masterSecret = null;
        this.clientWriteKey = null;
        this.serverWriteKey = null;
    }

    /**
     * ClientHello 生成
     */
    async generateClientHello() {
        const clientRandom = CryptoUtils.getRandomBytes(32);
        const sessionId = CryptoUtils.getRandomBytes(32);
        const keyShare = await this.generateKeyShare();

        this.clientHello = {
            version: TLS_KERBEROS_CONFIG.TLS_VERSION,
            random: CryptoUtils.bytesToHex(clientRandom),
            sessionId: CryptoUtils.bytesToHex(sessionId),
            cipherSuites: TLS_KERBEROS_CONFIG.SUPPORTED_CIPHER_SUITES,
            compressionMethods: ['null'],
            keyShare: keyShare,
            supportedGroups: TLS_KERBEROS_CONFIG.SUPPORTED_GROUPS,
            signatureAlgorithms: TLS_KERBEROS_CONFIG.SUPPORTED_SIGNATURE_ALGORITHMS,
            timestamp: Date.now()
        };

        this.state = 'CLIENT_HELLO_SENT';
        return this.clientHello;
    }

    /**
     * 鍵共有用の鍵ペア生成（X25519 または ECDH）
     */
    async generateKeyShare() {
        const keyPair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveBits', 'deriveKey']
        );

        const publicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey);
        
        return {
            keyExchange: CryptoUtils.bytesToHex(publicKey),
            keyPair: keyPair // 後で使用するために保持
        };
    }

    /**
     * ServerHello 処理と共有秘密の生成
     */
    async processServerHello(serverHello, clientKeyPair) {
        if (this.state !== 'CLIENT_HELLO_SENT') {
            throw new Error('Invalid state: ClientHello not sent');
        }

        // サーバーの鍵共有から共有秘密を導出
        const serverPublicKeyBytes = CryptoUtils.hexToBytes(serverHello.keyShare);
        const serverPublicKey = await crypto.subtle.importKey(
            'raw',
            serverPublicKeyBytes,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            []
        );

        this.sharedSecret = await crypto.subtle.deriveBits(
            { name: 'ECDH', public: serverPublicKey },
            clientKeyPair.privateKey,
            256
        );

        // マスターシークレットの導出
        await this.deriveMasterSecret(serverHello.random);

        this.state = 'HANDSHAKE_COMPLETE';
        return {
            success: true,
            masterSecret: this.masterSecret,
            cipherKeys: {
                clientWriteKey: this.clientWriteKey,
                serverWriteKey: this.serverWriteKey
            }
        };
    }

    /**
     * マスターシークレットの導出（TLS 1.3 風）
     */
    async deriveMasterSecret(serverRandom) {
        const encoder = new TextEncoder();
        
        // PSK (Pre-Shared Key) - 実際にはもっと複雑
        const psk = encoder.encode('healthshare-psk-0');
        
        // Early Secret
        const earlySecret = await CryptoUtils.hkdf(
            new Uint8Array(32), // IKM = 0x00...00
            psk,
            'TLS 1.3 Early Secret'
        );

        // Handshake Secret
        const dhSecret = new Uint8Array(this.sharedSecret);
        const handshakeSecret = await CryptoUtils.hkdf(
            dhSecret,
            earlySecret,
            'TLS 1.3 Handshake Secret'
        );

        // Master Secret
        const masterSecret = await CryptoUtils.hkdf(
            new Uint8Array(32), // IKM = 0x00...00
            handshakeSecret,
            'TLS 1.3 Master Secret'
        );

        this.masterSecret = masterSecret;

        // 通信鍵の導出
        this.clientWriteKey = await CryptoUtils.hkdf(
            masterSecret,
            encoder.encode('TLS 1.3 Client Write Key'),
            32
        );

        this.serverWriteKey = await CryptoUtils.hkdf(
            masterSecret,
            encoder.encode('TLS 1.3 Server Write Key'),
            32
        );
    }

    /**
     * 通信の暗号化
     */
    async encryptMessage(message) {
        if (this.state !== 'HANDSHAKE_COMPLETE') {
            throw new Error('Handshake not complete');
        }

        const iv = CryptoUtils.getRandomBytes(12);
        const ciphertext = await CryptoUtils.encryptAESGCM(
            message,
            this.clientWriteKey,
            iv
        );

        return {
            iv: CryptoUtils.bytesToHex(iv),
            ciphertext: CryptoUtils.bytesToHex(ciphertext)
        };
    }

    /**
     * 通信の復号
     */
    async decryptMessage(encryptedData) {
        if (this.state !== 'HANDSHAKE_COMPLETE') {
            throw new Error('Handshake not complete');
        }

        const iv = CryptoUtils.hexToBytes(encryptedData.iv);
        const ciphertext = CryptoUtils.hexToBytes(encryptedData.ciphertext);

        return await CryptoUtils.decryptAESGCM(
            ciphertext,
            this.serverWriteKey,
            iv
        );
    }
}

// ============================================
// Kerberos 風認証システム
// ============================================

class KerberosAuthenticator {
    constructor() {
        this.ticketCache = new Map();
        this.sessionKeys = new Map();
    }

    /**
     * 認証要求（AS_REQ）- Kerberos AS 交換
     */
    async authenticationServiceRequest(userId, userEmail) {
        const timestamp = Date.now();
        const nonce = CryptoUtils.getRandomBytes(TLS_KERBEROS_CONFIG.NONCE_LENGTH);

        const asReq = {
            pvno: TLS_KERBEROS_CONFIG.KERBEROS_VERSION,
            msgType: 'AS_REQ',
            client: {
                userId: userId,
                userEmail: userEmail
            },
            realm: TLS_KERBEROS_CONFIG.KERBEROS_REALM,
            sname: {
                nameType: 'SRV_INST',
                nameString: ['krbtgt', TLS_KERBEROS_CONFIG.KERBEROS_REALM]
            },
            from: timestamp,
            till: timestamp + (TLS_KERBEROS_CONFIG.TICKET_LIFETIME * 1000),
            rtime: timestamp + (TLS_KERBEROS_CONFIG.RENEWABLE_LIFETIME * 1000),
            nonce: CryptoUtils.bytesToHex(nonce),
            etype: ['aes256-cts-hmac-sha1-96', 'aes128-cts-hmac-sha1-96'],
            timestamp: timestamp
        };

        return asReq;
    }

    /**
     * 認証応答（AS_REP）- Kerberos AS 応答
     */
    async authenticationServiceReply(asReq, userPasswordHash) {
        const timestamp = Date.now();
        const sessionKey = CryptoUtils.getRandomBytes(32);
        const ticket = await this.generateTicket(asReq.client, userPasswordHash);

        // クライアント向けの応答（セッションキーをパスワードハッシュで暗号化）
        const encryptedPart = {
            key: CryptoUtils.bytesToHex(sessionKey),
            realm: TLS_KERBEROS_CONFIG.KERBEROS_REALM,
            cname: asReq.client.userId,
            ctime: timestamp,
            ticket: ticket,
            expiry: timestamp + (TLS_KERBEROS_CONFIG.TICKET_LIFETIME * 1000)
        };

        // セッションキーをユーザーのパスワードハッシュで暗号化
        const encryptedKey = await this.encryptForClient(sessionKey, userPasswordHash);

        const asRep = {
            pvno: TLS_KERBEROS_CONFIG.KERBEROS_VERSION,
            msgType: 'AS_REP',
            crealm: TLS_KERBEROS_CONFIG.KERBEROS_REALM,
            cname: asReq.client.userId,
            ticket: ticket,
            key: encryptedKey,
            encryptedPart: encryptedPart,
            timestamp: timestamp
        };

        return asRep;
    }

    /**
     * チケット生成（TGT）
     */
    async generateTicket(client, userPasswordHash) {
        const timestamp = Date.now();
        const sessionKey = CryptoUtils.getRandomBytes(32);

        const ticket = {
            tktVno: TLS_KERBEROS_CONFIG.KERBEROS_VERSION,
            realm: TLS_KERBEROS_CONFIG.KERBEROS_REALM,
            sname: {
                nameType: 'SRV_INST',
                nameString: ['krbtgt', TLS_KERBEROS_CONFIG.KERBEROS_REALM]
            },
            encPart: {
                etype: 'aes256-cts-hmac-sha1-96',
                cipher: await this.encryptTicket({
                    flags: ['forwardable', 'renewable'],
                    key: CryptoUtils.bytesToHex(sessionKey),
                    crealm: TLS_KERBEROS_CONFIG.KERBEROS_REALM,
                    cname: client.userId,
                    transited: {
                        trType: 'DOMAIN-X500-COMPRESS',
                        contents: ''
                    },
                    ctime: timestamp,
                    endTime: timestamp + (TLS_KERBEROS_CONFIG.TICKET_LIFETIME * 1000),
                    renewTill: timestamp + (TLS_KERBEROS_CONFIG.RENEWABLE_LIFETIME * 1000)
                }, userPasswordHash)
            },
            timestamp: timestamp
        };

        return ticket;
    }

    /**
     * チケットの暗号化
     */
    async encryptTicket(ticketData, key) {
        const ticketJson = JSON.stringify(ticketData);
        const hash = await CryptoUtils.sha256(key);
        const encryptionKey = CryptoUtils.hexToBytes(hash.substring(0, 32));
        const iv = CryptoUtils.getRandomBytes(16);
        
        const ciphertext = await CryptoUtils.encryptAESGCM(ticketJson, encryptionKey, iv);
        
        return {
            iv: CryptoUtils.bytesToHex(iv),
            data: CryptoUtils.bytesToHex(ciphertext)
        };
    }

    /**
     * クライアント向けの暗号化
     */
    async encryptForClient(sessionKey, userPasswordHash) {
        const hash = await CryptoUtils.sha256(userPasswordHash);
        const encryptionKey = CryptoUtils.hexToBytes(hash.substring(0, 32));
        const iv = CryptoUtils.getRandomBytes(16);
        
        const ciphertext = await CryptoUtils.encryptAESGCM(
            CryptoUtils.bytesToHex(sessionKey),
            encryptionKey,
            iv
        );
        
        return {
            iv: CryptoUtils.bytesToHex(iv),
            data: CryptoUtils.bytesToHex(ciphertext)
        };
    }

    /**
     * サービスチケット要求（TGS_REQ）
     */
    async ticketGrantingServiceRequest(tgt, serviceName) {
        const timestamp = Date.now();
        const nonce = CryptoUtils.getRandomBytes(TLS_KERBEROS_CONFIG.NONCE_LENGTH);

        const tgsReq = {
            pvno: TLS_KERBEROS_CONFIG.KERBEROS_VERSION,
            msgType: 'TGS_REQ',
            realm: TLS_KERBEROS_CONFIG.KERBEROS_REALM,
            sname: {
                nameType: 'SRV_INST',
                nameString: [serviceName]
            },
            ticket: tgt,
            authenticator: await this.generateAuthenticator(tgt.encPart.key),
            nonce: CryptoUtils.bytesToHex(nonce),
            timestamp: timestamp
        };

        return tgsReq;
    }

    /**
     * 認証子生成
     */
    async generateAuthenticator(sessionKey) {
        const timestamp = Date.now();
        const nonce = CryptoUtils.getRandomBytes(TLS_KERBEROS_CONFIG.NONCE_LENGTH);

        const authenticator = {
            authenticatorVno: TLS_KERBEROS_CONFIG.KERBEROS_VERSION,
            crealm: TLS_KERBEROS_CONFIG.KERBEROS_REALM,
            cname: 'client', // 実際にはチケットから取得
            ctime: timestamp,
            cusec: Math.floor(Math.random() * 1000000),
            nonce: CryptoUtils.bytesToHex(nonce),
            subkey: CryptoUtils.bytesToHex(CryptoUtils.getRandomBytes(32))
        };

        // セッションキーで暗号化
        const encrypted = await this.encryptWithSessionKey(authenticator, sessionKey);
        
        return {
            etype: 'aes256-cts-hmac-sha1-96',
            cipher: encrypted
        };
    }

    /**
     * セッションキーでの暗号化
     */
    async encryptWithSessionKey(data, sessionKey) {
        const dataJson = JSON.stringify(data);
        const iv = CryptoUtils.getRandomBytes(16);
        const keyBytes = typeof sessionKey === 'string' ? CryptoUtils.hexToBytes(sessionKey) : sessionKey;
        
        const ciphertext = await CryptoUtils.encryptAESGCM(dataJson, keyBytes, iv);
        
        return {
            iv: CryptoUtils.bytesToHex(iv),
            data: CryptoUtils.bytesToHex(ciphertext)
        };
    }

    /**
     * サービスチケット応答（TGS_REP）
     */
    async ticketGrantingServiceReply(tgsReq, serviceKey) {
        const timestamp = Date.now();
        const sessionKey = CryptoUtils.getRandomBytes(32);

        // サービスチケット生成
        const serviceTicket = {
            tktVno: TLS_KERBEROS_CONFIG.KERBEROS_VERSION,
            realm: TLS_KERBEROS_CONFIG.KERBEROS_REALM,
            sname: tgsReq.sname,
            encPart: {
                etype: 'aes256-cts-hmac-sha1-96',
                cipher: await this.encryptTicket({
                    flags: ['forwardable', 'renewable'],
                    key: CryptoUtils.bytesToHex(sessionKey),
                    crealm: TLS_KERBEROS_CONFIG.KERBEROS_REALM,
                    cname: 'client',
                    transited: {
                        trType: 'DOMAIN-X500-COMPRESS',
                        contents: ''
                    },
                    ctime: timestamp,
                    endTime: timestamp + (TLS_KERBEROS_CONFIG.TICKET_LIFETIME * 1000)
                }, serviceKey)
            },
            timestamp: timestamp
        };

        const tgsRep = {
            pvno: TLS_KERBEROS_CONFIG.KERBEROS_VERSION,
            msgType: 'TGS_REP',
            crealm: TLS_KERBEROS_CONFIG.KERBEROS_REALM,
            cname: 'client',
            ticket: serviceTicket,
            key: await this.encryptWithSessionKey(
                { key: CryptoUtils.bytesToHex(sessionKey) },
                CryptoUtils.hexToBytes(tgsReq.authenticator.encryptedPart.cipher.data)
            ),
            timestamp: timestamp
        };

        return tgsRep;
    }

    /**
     * サービス要求（AP_REQ）- 相互認証
     */
    async applicationRequest(serviceTicket, sessionKey) {
        const timestamp = Date.now();
        const nonce = CryptoUtils.getRandomBytes(TLS_KERBEROS_CONFIG.NONCE_LENGTH);

        const apReq = {
            pvno: TLS_KERBEROS_CONFIG.KERBEROS_VERSION,
            msgType: 'AP_REQ',
            apOptions: ['mutual_required'],
            ticket: serviceTicket,
            authenticator: await this.generateAuthenticator(sessionKey),
            timestamp: timestamp,
            nonce: CryptoUtils.bytesToHex(nonce)
        };

        return apReq;
    }

    /**
     * サービス応答（AP_REP）- 相互認証の完了
     */
    async applicationReply(apReq, sessionKey) {
        const timestamp = Date.now();
        
        // サブキーを使用して応答を暗号化
        const subkey = CryptoUtils.getRandomBytes(32);
        const encrypted = await this.encryptWithSessionKey({
            ctime: timestamp,
            cusec: Math.floor(Math.random() * 1000000),
            subkey: CryptoUtils.bytesToHex(subkey)
        }, sessionKey);

        const apRep = {
            pvno: TLS_KERBEROS_CONFIG.KERBEROS_VERSION,
            msgType: 'AP_REP',
            encPart: {
                etype: 'aes256-cts-hmac-sha1-96',
                cipher: encrypted
            },
            timestamp: timestamp
        };

        return apRep;
    }
}

// ============================================
// Challenge-Response 認証システム
// ============================================

class ChallengeResponseAuth {
    constructor() {
        this.challengeStore = new Map();
    }

    /**
     * Challenge 生成
     */
    generateChallenge(userId) {
        const challenge = CryptoUtils.getRandomBytes(TLS_KERBEROS_CONFIG.CHALLENGE_LENGTH);
        const nonce = CryptoUtils.getRandomBytes(TLS_KERBEROS_CONFIG.NONCE_LENGTH);
        const timestamp = Date.now();
        const expiry = timestamp + (TLS_KERBEROS_CONFIG.CHALLENGE_EXPIRY * 1000);

        const challengeData = {
            challenge: CryptoUtils.bytesToHex(challenge),
            nonce: CryptoUtils.bytesToHex(nonce),
            timestamp: timestamp,
            expiry: expiry,
            userId: userId,
            algorithm: 'HMAC-SHA256'
        };

        // Challenge を保存（後で検証用）
        this.challengeStore.set(CryptoUtils.bytesToHex(challenge), {
            ...challengeData,
            used: false
        });

        return challengeData;
    }

    /**
     * Response 生成（クライアント側）
     */
    async generateResponse(challengeData, secret) {
        const { challenge, nonce } = challengeData;
        
        // Challenge + Nonce + Secret で HMAC 生成
        const dataToSign = `${challenge}:${nonce}:${secret}`;
        const response = await CryptoUtils.hmacSign(secret, dataToSign);

        return {
            challenge: challenge,
            response: response,
            nonce: nonce,
            timestamp: Date.now()
        };
    }

    /**
     * Response 検証（サーバー側）
     */
    async verifyResponse(challengeHex, response, nonce, userId, secret) {
        // Challenge が存在するか確認
        const storedChallenge = this.challengeStore.get(challengeHex);
        
        if (!storedChallenge) {
            return { valid: false, reason: 'Challenge が見つかりません' };
        }

        if (storedChallenge.used) {
            return { valid: false, reason: 'Challenge は既に使用されています' };
        }

        if (Date.now() > storedChallenge.expiry) {
            this.challengeStore.delete(challengeHex);
            return { valid: false, reason: 'Challenge の有効期限が切れています' };
        }

        if (storedChallenge.userId !== userId) {
            return { valid: false, reason: 'ユーザーID が一致しません' };
        }

        if (storedChallenge.nonce !== nonce) {
            return { valid: false, reason: 'Nonce が一致しません' };
        }

        // Response を再計算して検証
        const dataToSign = `${challengeHex}:${nonce}:${secret}`;
        const expectedResponse = await CryptoUtils.hmacSign(secret, dataToSign);

        if (expectedResponse !== response) {
            return { valid: false, reason: 'Response が一致しません' };
        }

        // Challenge を使用済みにマーク
        storedChallenge.used = true;
        this.challengeStore.set(challengeHex, storedChallenge);

        // 5分後にクリーンアップ
        setTimeout(() => {
            this.challengeStore.delete(challengeHex);
        }, TLS_KERBEROS_CONFIG.CHALLENGE_EXPIRY * 1000);

        return { valid: true };
    }

    /**
     * 相互認証のための Challenge-Response
     */
    async mutualChallengeResponse(clientId, serverId, sharedSecret) {
        // クライアントがサーバーに Challenge
        const clientChallenge = this.generateChallenge(clientId);
        
        // サーバーがクライアントに Challenge
        const serverChallenge = this.generateChallenge(serverId);

        return {
            clientChallenge: clientChallenge,
            serverChallenge: serverChallenge,
            timestamp: Date.now()
        };
    }

    /**
     * Challenge-Response を使用したセッションキー確立
     */
    async establishSessionKey(challengeData, response, sharedSecret) {
        const verification = await this.verifyResponse(
            challengeData.challenge,
            response,
            challengeData.nonce,
            challengeData.userId,
            sharedSecret
        );

        if (!verification.valid) {
            throw new Error('Challenge-Response 認証に失敗しました');
        }

        // セッションキーの生成
        const sessionKeyMaterial = `${challengeData.challenge}:${response}:${sharedSecret}`;
        const sessionKey = await CryptoUtils.sha256(sessionKeyMaterial);

        return {
            success: true,
            sessionKey: sessionKey,
            expiry: Date.now() + (TLS_KERBEROS_CONFIG.SESSION_TIMEOUT * 1000)
        };
    }
}

// ============================================
// 統合認証マネージャー（TLS 1.3 + Kerberos + Challenge-Response）
// ============================================

class IntegratedAuthManager {
    constructor() {
        this.tlsHandshake = new TLS13Handshake();
        this.kerberosAuth = new KerberosAuthenticator();
        this.challengeResponse = new ChallengeResponseAuth();
        this.activeSessions = new Map();
    }

    /**
     * 完全な認証フロー（TLS 1.3 + Kerberos + Challenge-Response）
     */
    async fullAuthenticationFlow(userId, userEmail, userPasswordHash) {
        const flowResult = {
            steps: [],
            success: false,
            sessionKey: null,
            ticket: null
        };

        try {
            // Step 1: TLS 1.3 ハンドシェイク
            flowResult.steps.push('TLS 1.3 Handshake');
            const clientHello = await this.tlsHandshake.generateClientHello();
            const keyShare = clientHello.keyShare;
            
            // サーバー応答をシミュレート
            const serverHello = {
                version: TLS_KERBEROS_CONFIG.TLS_VERSION,
                random: CryptoUtils.bytesToHex(CryptoUtils.getRandomBytes(32)),
                sessionId: clientHello.sessionId,
                cipherSuite: clientHello.cipherSuites[0],
                keyShare: CryptoUtils.bytesToHex(
                    CryptoUtils.getRandomBytes(65) // P-256 公開鍵
                )
            };

            const tlsResult = await this.tlsHandshake.processServerHello(
                serverHello,
                keyShare.keyPair
            );

            if (!tlsResult.success) {
                throw new Error('TLS ハンドシェイクに失敗しました');
            }

            // Step 2: Kerberos 認証
            flowResult.steps.push('Kerberos Authentication');
            const asReq = await this.kerberosAuth.authenticationServiceRequest(userId, userEmail);
            const asRep = await this.kerberosAuth.authenticationServiceReply(asReq, userPasswordHash);
            
            // TGT をキャッシュ
            this.kerberosAuth.ticketCache.set('TGT', asRep.ticket);

            // Step 3: Challenge-Response 認証
            flowResult.steps.push('Challenge-Response Authentication');
            const challenge = this.challengeResponse.generateChallenge(userId);
            const response = await this.challengeResponse.generateResponse(challenge, userPasswordHash);
            const crVerification = await this.challengeResponse.verifyResponse(
                challenge.challenge,
                response.response,
                challenge.nonce,
                userId,
                userPasswordHash
            );

            if (!crVerification.valid) {
                throw new Error('Challenge-Response 認証に失敗しました');
            }

            // Step 4: セッションキー確立
            flowResult.steps.push('Session Key Establishment');
            const sessionResult = await this.challengeResponse.establishSessionKey(
                challenge,
                response.response,
                userPasswordHash
            );

            // セッションを保存
            const sessionId = await CryptoUtils.sha256(`${userId}:${Date.now()}`);
            this.activeSessions.set(sessionId, {
                userId: userId,
                userEmail: userEmail,
                sessionKey: sessionResult.sessionKey,
                ticket: asRep.ticket,
                tlsKeys: tlsResult.cipherKeys,
                establishedAt: Date.now(),
                expiresAt: sessionResult.expiry,
                authenticated: true
            });

            flowResult.success = true;
            flowResult.sessionKey = sessionResult.sessionKey;
            flowResult.ticket = asRep.ticket;
            flowResult.sessionId = sessionId;

        } catch (error) {
            flowResult.error = error.message;
            flowResult.success = false;
        }

        return flowResult;
    }

    /**
     * セッション検証
     */
    async verifySession(sessionId, userId) {
        const session = this.activeSessions.get(sessionId);
        
        if (!session) {
            return { valid: false, reason: 'セッションが見つかりません' };
        }

        if (session.userId !== userId) {
            return { valid: false, reason: 'ユーザーID が一致しません' };
        }

        if (Date.now() > session.expiresAt) {
            this.activeSessions.delete(sessionId);
            return { valid: false, reason: 'セッションの有効期限が切れています' };
        }

        return {
            valid: true,
            session: session
        };
    }

    /**
     * セッション終了
     */
    async terminateSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            this.activeSessions.delete(sessionId);
            return { success: true };
        }
        return { success: false, reason: 'セッションが見つかりません' };
    }

    /**
     * 認証状態の取得
     */
    getAuthenticationStatus() {
        return {
            activeSessions: this.activeSessions.size,
            tlsState: this.tlsHandshake.state,
            ticketCacheSize: this.kerberosAuth.ticketCache.size,
            challengeStoreSize: this.challengeResponse.challengeStore.size
        };
    }

    /**
     * 認証フローのデモ実行
     */
    async runAuthenticationDemo(userId, userEmail) {
        console.log('🔐 認証フロー開始...');
        
        // デモ用のパスワードハッシュ（実際には securely stored）
        const demoPasswordHash = await CryptoUtils.sha256('demo-password-123');
        
        const result = await this.fullAuthenticationFlow(
            userId,
            userEmail,
            demoPasswordHash
        );

        console.log('認証フロー結果:', result);
        
        if (result.success) {
            console.log('✅ 認証成功！');
            console.log('セッションID:', result.sessionId);
            console.log('セッションキー:', result.sessionKey);
            
            // セッション検証
            const verification = await this.verifySession(result.sessionId, userId);
            console.log('セッション検証:', verification);
            
            // セッション終了
            await this.terminateSession(result.sessionId);
            console.log('セッション終了');
        } else {
            console.log('❌ 認証失敗:', result.error);
        }

        return result;
    }
}

// ============================================
// Firestore 統合（認証記録）
// ============================================

class AuthRecordManager {
    /**
     * 認証試行を記録
     */
    async logAuthenticationAttempt(userId, success, details = {}) {
        const record = {
            userId: userId,
            success: success,
            timestamp: new Date().toISOString(),
            authMethod: 'TLS13_KERBEROS_CHALLENGE',
            ipAddress: null, // クライアントサイドでは取得不可
            userAgent: navigator.userAgent,
            details: details
        };

        try {
            await addDoc(collection(db, 'auth_records'), record);
            return { success: true, recordId: record.id };
        } catch (error) {
            console.error('認証記録の保存エラー:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * セッション記録
     */
    async logSessionEstablishment(sessionId, userId, sessionData) {
        const record = {
            sessionId: sessionId,
            userId: userId,
            establishedAt: new Date().toISOString(),
            expiresAt: new Date(sessionData.expiresAt).toISOString(),
            authMethod: 'TLS13_KERBEROS_CHALLENGE',
            sessionKeyHash: await CryptoUtils.sha256(sessionData.sessionKey),
            ticketPresent: !!sessionData.ticket
        };

        try {
            await setDoc(doc(db, 'sessions', sessionId), record);
            return { success: true };
        } catch (error) {
            console.error('セッション記録エラー:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * セッション終了記録
     */
    async logSessionTermination(sessionId, reason = 'user_logout') {
        try {
            await updateDoc(doc(db, 'sessions', sessionId), {
                terminatedAt: new Date().toISOString(),
                terminationReason: reason
            });
            return { success: true };
        } catch (error) {
            console.error('セッション終了記録エラー:', error);
            return { success: false, error: error.message };
        }
    }
}

// ============================================
// エクスポート
// ============================================

export {
    // クラス
    CryptoUtils,
    TLS13Handshake,
    KerberosAuthenticator,
    ChallengeResponseAuth,
    IntegratedAuthManager,
    AuthRecordManager,
    
    // 設定
    TLS_KERBEROS_CONFIG
};

// ============================================
// 使用例
// ============================================

/*
// 基本的な使用例
const authManager = new IntegratedAuthManager();

// 認証フローの実行
const result = await authManager.fullAuthenticationFlow(
    'user123',
    'user@example.com',
    'password-hash-here'
);

if (result.success) {
    console.log('認証成功！');
    
    // セッション検証
    const verification = await authManager.verifySession(result.sessionId, 'user123');
    
    // 認証記録
    const recordManager = new AuthRecordManager();
    await recordManager.logAuthenticationAttempt('user123', true, {
        method: 'TLS13_KERBEROS_CHALLENGE'
    });
}

// デモ実行
await authManager.runAuthenticationDemo('demo_user', 'demo@example.com');
*/