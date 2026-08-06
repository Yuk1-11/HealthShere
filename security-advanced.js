// ============================================
// 高度なセキュリティモジュール
// OTPトークン署名、SHA-2パスワードハッシュ、RFC3645/GSS-API風認証
// ============================================

import { auth, db } from "./firebase.js";
import {
    doc,
    getDoc,
    setDoc,
    updateDoc
} from "firebase/firestore";

// ============================================
// 定数定義
// ============================================

const SECURITY_CONFIG = {
    // SHA-2 アルゴリズム設定
    SHA256: { name: 'SHA-256', length: 32 },
    SHA512: { name: 'SHA-512', length: 64 },
    
    // HMAC-SHA2 設定
    HMAC_SHA256: { name: 'HMAC', hash: 'SHA-256' },
    HMAC_SHA512: { name: 'HMAC', hash: 'SHA-512' },
    
    // PBKDF2 設定（パスワード導出関数）
    PBKDF2_ITERATIONS: 100000,
    PBKDF2_SALT_LENGTH: 32,
    
    // OTP 設定
    OTP_LENGTH: 6,
    OTP_PERIOD: 30,
    OTP_WINDOW: 1,
    
    // トランザクション署名設定
    TRANSACTION_SIGNATURE_VERSION: '1.0',
    TRANSACTION_SIGNATURE_EXPIRY: 300, // 5分
    
    // GSS-API 風トークン設定
    GSS_TOKEN_VERSION: 1,
    GSS_TOKEN_LIFETIME: 3600, // 1時間
};

// ============================================
// SHA-2 パスワードハッシュマネージャー
// ============================================

class SHA2PasswordHasher {
    /**
     * ランダムなソルトを生成
     */
    static generateSalt(length = SECURITY_CONFIG.PBKDF2_SALT_LENGTH) {
        const salt = new Uint8Array(length);
        crypto.getRandomValues(salt);
        return salt;
    }

    /**
     * パスワードをSHA-256でハッシュ
     */
    static async hashSHA256(password, salt) {
        const encoder = new TextEncoder();
        const passwordData = encoder.encode(password);
        
        const hashBuffer = await crypto.subtle.digest('SHA-256', passwordData);
        const hashArray = new Uint8Array(hashBuffer);
        
        // ソルトと結合して再ハッシュ（ソルティング）
        const saltedData = new Uint8Array(salt.length + hashArray.length);
        saltedData.set(salt);
        saltedData.set(hashArray, salt.length);
        
        const finalHash = await crypto.subtle.digest('SHA-256', saltedData);
        return {
            hash: Array.from(new Uint8Array(finalHash)).map(b => b.toString(16).padStart(2, '0')).join(''),
            salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
        };
    }

    /**
     * パスワードをSHA-512でハッシュ
     */
    static async hashSHA512(password, salt) {
        const encoder = new TextEncoder();
        const passwordData = encoder.encode(password);
        
        const hashBuffer = await crypto.subtle.digest('SHA-512', passwordData);
        const hashArray = new Uint8Array(hashBuffer);
        
        // ソルトと結合して再ハッシュ
        const saltedData = new Uint8Array(salt.length + hashArray.length);
        saltedData.set(salt);
        saltedData.set(hashArray, salt.length);
        
        const finalHash = await crypto.subtle.digest('SHA-512', saltedData);
        return {
            hash: Array.from(new Uint8Array(finalHash)).map(b => b.toString(16).padStart(2, '0')).join(''),
            salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
        };
    }

    /**
     * PBKDF2を使用してパスワードを導出（より安全）
     */
    static async hashPBKDF2(password, salt, iterations = SECURITY_CONFIG.PBKDF2_ITERATIONS) {
        const encoder = new TextEncoder();
        const passwordData = encoder.encode(password);
        
        const key = await crypto.subtle.importKey(
            'raw',
            passwordData,
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        );
        
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: iterations,
                hash: 'SHA-256'
            },
            key,
            256
        );
        
        return {
            hash: Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join(''),
            salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join(''),
            iterations: iterations
        };
    }

    /**
     * パスワードを検証
     */
    static async verifyPassword(password, storedHash, storedSalt, algorithm = 'SHA-256') {
        const salt = new Uint8Array(storedSalt.match(/[\da-f]{2}/gi).map(h => parseInt(h, 16)));
        
        let result;
        if (algorithm === 'SHA-512') {
            result = await this.hashSHA512(password, salt);
        } else {
            result = await this.hashSHA256(password, salt);
        }
        
        return result.hash === storedHash;
    }
}

// ============================================
// OTP トランザクション署名マネージャー
// ============================================

class OTPTransactionSigner {
    /**
     * トランザクション署名を生成
     * ユーザーIDとメールアドレスをOTPトークンで署名
     */
    static async generateTransactionSignature(userId, userEmail, otpToken, timestamp = Date.now()) {
        const encoder = new TextEncoder();
        
        // 署名データを作成
        const signatureData = {
            version: SECURITY_CONFIG.TRANSACTION_SIGNATURE_VERSION,
            userId: userId,
            userEmail: userEmail,
            otpToken: otpToken,
            timestamp: timestamp,
            expiry: timestamp + (SECURITY_CONFIG.TRANSACTION_SIGNATURE_EXPIRY * 1000),
            nonce: this.generateNonce()
        };
        
        // 署名用の文字列を作成
        const signatureString = JSON.stringify(signatureData);
        
        // HMAC-SHA256で署名
        const key = await this.deriveSigningKey(userId, userEmail);
        const signature = await this.signData(key, signatureString);
        
        return {
            data: signatureData,
            signature: signature,
            signatureString: signatureString
        };
    }

    /**
     * 署名キーを導出
     */
    static async deriveSigningKey(userId, userEmail) {
        const encoder = new TextEncoder();
        const keyMaterial = encoder.encode(`${userId}:${userEmail}:signing-key`);
        
        const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial);
        return crypto.subtle.importKey(
            'raw',
            hashBuffer,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );
    }

    /**
     * データに署名
     */
    static async signData(key, data) {
        const encoder = new TextEncoder();
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
        return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * 署名を検証
     */
    static async verifySignature(userId, userEmail, signatureData, providedSignature) {
        // 有効期限チェック
        if (Date.now() > signatureData.expiry) {
            return { valid: false, reason: '署名の有効期限が切れています' };
        }
        
        // 署名を再生成して比較
        const key = await this.deriveSigningKey(userId, userEmail);
        const signatureString = JSON.stringify(signatureData);
        const expectedSignature = await this.signData(key, signatureString);
        
        if (expectedSignature !== providedSignature) {
            return { valid: false, reason: '署名が一致しません' };
        }
        
        return { valid: true };
    }

    /**
     * ランダムなナンスを生成
     */
    static generateNonce(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let nonce = '';
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        for (let i = 0; i < length; i++) {
            nonce += chars[array[i] % chars.length];
        }
        return nonce;
    }
}

// ============================================
// GSS-API 風認証トークンマネージャー
// RFC3645 (GSS-API Kerberos SASL Mechanism) 風の認証
// ============================================

class GSSAPITokenManager {
    /**
     * GSS-API 風トークンを生成
     */
    static async generateToken(userId, userEmail, permissions = []) {
        const timestamp = Date.now();
        const expiry = timestamp + (SECURITY_CONFIG.GSS_TOKEN_LIFETIME * 1000);
        
        // トークンペイロード
        const tokenPayload = {
            version: SECURITY_CONFIG.GSS_TOKEN_VERSION,
            type: 'GSS-API',
            userId: userId,
            userEmail: userEmail,
            permissions: permissions,
            issuedAt: timestamp,
            expiry: expiry,
            nonce: OTPTransactionSigner.generateNonce(16)
        };
        
        // トークン署名
        const signature = await this.signToken(tokenPayload, userId, userEmail);
        
        return {
            token: {
                ...tokenPayload,
                signature: signature
            },
            tokenString: btoa(JSON.stringify({
                ...tokenPayload,
                signature: signature
            }))
        };
    }

    /**
     * トークンに署名
     */
    static async signToken(tokenPayload, userId, userEmail) {
        const encoder = new TextEncoder();
        const payloadString = JSON.stringify(tokenPayload);
        
        // サーバーキーで署名（実際にはサーバーサイドで実装すべき）
        const keyMaterial = encoder.encode(`gss-api:${userId}:${userEmail}:server-key`);
        const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial);
        const key = await crypto.subtle.importKey(
            'raw',
            hashBuffer,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadString));
        return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * トークンを検証
     */
    static async verifyToken(tokenString, userId, userEmail) {
        try {
            const token = JSON.parse(atob(tokenString));
            
            // 有効期限チェック
            if (Date.now() > token.expiry) {
                return { valid: false, reason: 'トークンの有効期限が切れています' };
            }
            
            // 署名検証
            const expectedSignature = await this.signToken(
                {
                    version: token.version,
                    type: token.type,
                    userId: token.userId,
                    userEmail: token.userEmail,
                    permissions: token.permissions,
                    issuedAt: token.issuedAt,
                    expiry: token.expiry,
                    nonce: token.nonce
                },
                userId,
                userEmail
            );
            
            if (expectedSignature !== token.signature) {
                return { valid: false, reason: 'トークンの署名が無効です' };
            }
            
            // ユーザーIDチェック
            if (token.userId !== userId) {
                return { valid: false, reason: 'トークンのユーザーIDが一致しません' };
            }
            
            return { valid: true, token: token };
        } catch (error) {
            return { valid: false, reason: 'トークンの解析に失敗しました' };
        }
    }

    /**
     * トークンから権限を取得
     */
    static getPermissions(token) {
        if (!token || !token.permissions) return [];
        return token.permissions;
    }
}

// ============================================
// 統合セキュリティマネージャー
// ============================================

class SecurityManager {
    constructor() {
        this.currentToken = null;
        this.signatureHistory = [];
    }

    /**
     * ユーザーのセキュリティ設定を初期化
     */
    async initializeUserSecurity(userId, userEmail) {
        const salt = SHA2PasswordHasher.generateSalt();
        const securityConfig = {
            userId: userId,
            userEmail: userEmail,
            salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join(''),
            algorithms: ['SHA-256', 'SHA-512', 'PBKDF2'],
            otpEnabled: false,
            gssApiEnabled: false,
            transactionSigningEnabled: false,
            createdAt: new Date().toISOString(),
            lastSecurityUpdate: new Date().toISOString()
        };
        
        try {
            await setDoc(doc(db, 'security', userId), securityConfig);
            return securityConfig;
        } catch (error) {
            console.error('セキュリティ設定の初期化エラー:', error);
            throw error;
        }
    }

    /**
     * ユーザーのセキュリティ設定を取得
     */
    async getUserSecurityConfig(userId) {
        try {
            const docRef = doc(db, 'security', userId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                return docSnap.data();
            }
            return null;
        } catch (error) {
            console.error('セキュリティ設定の取得エラー:', error);
            return null;
        }
    }

    /**
     * パスワードを安全にハッシュ化して保存
     */
    async hashAndStorePassword(userId, password) {
        const salt = SHA2PasswordHasher.generateSalt();
        const hashResult = await SHA2PasswordHasher.hashPBKDF2(password, salt);
        
        try {
            await updateDoc(doc(db, 'security', userId), {
                passwordHash: hashResult.hash,
                passwordSalt: hashResult.salt,
                passwordIterations: hashResult.iterations,
                passwordAlgorithm: 'PBKDF2-SHA256',
                lastPasswordChange: new Date().toISOString()
            });
            
            return hashResult;
        } catch (error) {
            console.error('パスワードハッシュの保存エラー:', error);
            throw error;
        }
    }

    /**
     * パスワードを検証
     */
    async verifyPassword(userId, password) {
        const securityConfig = await this.getUserSecurityConfig(userId);
        if (!securityConfig || !securityConfig.passwordHash) {
            return { valid: false, reason: 'パスワードが設定されていません' };
        }
        
        const salt = new Uint8Array(
            securityConfig.passwordSalt.match(/[\da-f]{2}/gi).map(h => parseInt(h, 16))
        );
        
        let isValid;
        if (securityConfig.passwordAlgorithm === 'PBKDF2-SHA256') {
            const hashResult = await SHA2PasswordHasher.hashPBKDF2(
                password, 
                salt, 
                securityConfig.passwordIterations || SECURITY_CONFIG.PBKDF2_ITERATIONS
            );
            isValid = hashResult.hash === securityConfig.passwordHash;
        } else {
            isValid = await SHA2PasswordHasher.verifyPassword(
                password,
                securityConfig.passwordHash,
                securityConfig.passwordSalt,
                securityConfig.passwordAlgorithm
            );
        }
        
        return { valid: isValid };
    }

    /**
     * OTP トランザクション署名を有効化
     */
    async enableOTPTransactionSigning(userId, userEmail, otpSecret) {
        try {
            await updateDoc(doc(db, 'security', userId), {
                transactionSigningEnabled: true,
                otpSecret: otpSecret,
                transactionSigningEnabledAt: new Date().toISOString()
            });
            
            return { success: true };
        } catch (error) {
            console.error('OTP トランザクション署名の有効化エラー:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * トランザクション署名を生成
     */
    async createTransactionSignature(userId, userEmail, otpToken) {
        const signature = await OTPTransactionSigner.generateTransactionSignature(
            userId, 
            userEmail, 
            otpToken
        );
        
        // 署名履歴に追加
        this.signatureHistory.push({
            ...signature.data,
            signature: signature.signature,
            createdAt: new Date().toISOString()
        });
        
        return signature;
    }

    /**
     * GSS-API トークンを生成
     */
    async generateGSSAPIToken(userId, userEmail, permissions = ['read', 'write']) {
        const result = await GSSAPITokenManager.generateToken(userId, userEmail, permissions);
        this.currentToken = result.token;
        
        try {
            await updateDoc(doc(db, 'security', userId), {
                gssApiEnabled: true,
                currentTokenExpiry: result.token.expiry,
                lastTokenGenerated: new Date().toISOString()
            });
        } catch (error) {
            console.error('GSS-API トークンの保存エラー:', error);
        }
        
        return result;
    }

    /**
     * セキュリティ監査ログを記録
     */
    async logSecurityEvent(userId, eventType, details = {}) {
        const logEntry = {
            userId: userId,
            eventType: eventType,
            details: details,
            timestamp: new Date().toISOString(),
            ipAddress: null, // クライアントサイドでは取得不可
            userAgent: navigator.userAgent
        };
        
        try {
            const docRef = doc(db, 'security_logs', `${userId}_${Date.now()}`);
            await setDoc(docRef, logEntry);
        } catch (error) {
            console.error('セキュリティログの記録エラー:', error);
        }
        
        return logEntry;
    }
}

// ============================================
// ユーティリティ関数
// ============================================

/**
 * 安全なランダムバイトを生成
 */
function generateSecureRandomBytes(length = 32) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

/**
 * バイト配列を16進数文字列に変換
 */
function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 16進数文字列をバイト配列に変換
 */
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

/**
 * Base64URL エンコード
 */
function base64UrlEncode(str) {
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Base64URL デコード
 */
function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    return atob(str);
}

// ============================================
// エクスポート
// ============================================

export {
    // クラス
    SHA2PasswordHasher,
    OTPTransactionSigner,
    GSSAPITokenManager,
    SecurityManager,
    
    // ユーティリティ
    generateSecureRandomBytes,
    bytesToHex,
    hexToBytes,
    base64UrlEncode,
    base64UrlDecode,
    
    // 設定
    SECURITY_CONFIG
};

// ============================================
// 使用例
// ============================================

/*
// 1. パスワードハッシュの例
const salt = SHA2PasswordHasher.generateSalt();
const hashResult = await SHA2PasswordHasher.hashPBKDF2('mySecurePassword', salt);
console.log('Hash:', hashResult.hash);
console.log('Salt:', hashResult.salt);

// 2. OTP トランザクション署名の例
const signature = await OTPTransactionSigner.generateTransactionSignature(
    'user123',
    'user@example.com',
    '123456' // OTP トークン
);
console.log('Signature:', signature);

// 3. GSS-API トークンの例
const gssToken = await GSSAPITokenManager.generateToken(
    'user123',
    'user@example.com',
    ['read', 'write', 'admin']
);
console.log('GSS Token:', gssToken.tokenString);

// 4. SecurityManager の使用例
const securityManager = new SecurityManager();
await securityManager.initializeUserSecurity('user123', 'user@example.com');
await securityManager.hashAndStorePassword('user123', 'mySecurePassword');
const isValid = await securityManager.verifyPassword('user123', 'mySecurePassword');
console.log('Password valid:', isValid.valid);
*/