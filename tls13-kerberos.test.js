// ============================================
// TLS 1.3 & Kerberos Challenge-Response 認証テスト
// ============================================

import {
    CryptoUtils,
    TLS13Handshake,
    KerberosAuthenticator,
    ChallengeResponseAuth,
    IntegratedAuthManager,
    AuthRecordManager,
    TLS_KERBEROS_CONFIG
} from './tls13-kerberos.js';

// ============================================
// テストユーティリティ
// ============================================

class TestRunner {
    constructor() {
        this.results = [];
        this.currentTest = '';
    }

    async run(name, testFn) {
        this.currentTest = name;
        try {
            await testFn();
            this.results.push({ name, passed: true });
            console.log(`✅ ${name}`);
        } catch (error) {
            this.results.push({ name, passed: false, error: error.message });
            console.log(`❌ ${name}`);
            console.log(`   エラー: ${error.message}`);
        }
    }

    assertEqual(actual, expected, message = '') {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`${message}\n  期待: ${JSON.stringify(expected)}\n  実際: ${JSON.stringify(actual)}`);
        }
    }

    assertTrue(condition, message = '') {
        if (!condition) {
            throw new Error(message || '条件が偽です');
        }
    }

    summary() {
        const passed = this.results.filter(r => r.passed).length;
        const failed = this.results.filter(r => !r.passed).length;
        console.log('\n========================================');
        console.log(`テスト結果: ${passed} 合格, ${failed} 不合格`);
        console.log('========================================\n');
        return { passed, failed, total: this.results.length };
    }
}

// ============================================
// テスト実行
// ============================================

async function runTests() {
    const test = new TestRunner();

    console.log('🧪 TLS 1.3 & Kerberos Challenge-Response 認証テスト開始...\n');

    // ============================================
    // CryptoUtils テスト
    // ============================================

    console.log('--- CryptoUtils テスト ---\n');

    await test.run('CryptoUtils.getRandomBytes 生成テスト', async () => {
        const bytes1 = CryptoUtils.getRandomBytes(32);
        const bytes2 = CryptoUtils.getRandomBytes(32);
        test.assertEqual(bytes1.length, 32, '長さ');
        test.assertEqual(bytes2.length, 32, '長さ');
        // 2つのランダムバイトが一致しないことを確認
        const areEqual = bytes1.every((b, i) => b === bytes2[i]);
        test.assertTrue(!areEqual, 'ランダムバイトが一意であること');
    });

    await test.run('CryptoUtils.bytesToHex / hexToBytes 変換テスト', async () => {
        const original = CryptoUtils.getRandomBytes(16);
        const hex = CryptoUtils.bytesToHex(original);
        const back = CryptoUtils.hexToBytes(hex);
        test.assertEqual(back.length, original.length, '長さ');
        test.assertEqual(Array.from(back), Array.from(original), '値');
    });

    await test.run('CryptoUtils.base64UrlEncode / base64UrlDecode 変換テスト', async () => {
        const original = 'Hello, World! こんにちは';
        const encoded = CryptoUtils.base64UrlEncode(original);
        const decoded = new TextDecoder().decode(CryptoUtils.base64UrlDecode(encoded));
        test.assertEqual(decoded, original, 'デコード結果');
    });

    await test.run('CryptoUtils.hmacSign / hmacVerify 署名テスト', async () => {
        const key = 'test-secret-key';
        const data = 'test data to sign';
        const signature = await CryptoUtils.hmacSign(key, data);
        const isValid = await CryptoUtils.hmacVerify(key, data, signature);
        test.assertTrue(isValid, '署名が有効');

        const isInvalid = await CryptoUtils.hmacVerify(key, 'different data', signature);
        test.assertTrue(!isInvalid, '異なるデータは無効');
    });

    await test.run('CryptoUtils.sha256 ハッシュテスト', async () => {
        const hash1 = await CryptoUtils.sha256('hello');
        const hash2 = await CryptoUtils.sha256('hello');
        const hash3 = await CryptoUtils.sha256('world');
        test.assertEqual(hash1, hash2, '同じ入力は同じハッシュ');
        test.assertTrue(hash1 !== hash3, '異なる入力は異なるハッシュ');
        test.assertEqual(hash1.length, 64, 'SHA-256 は64文字（256ビット）');
    });

    await test.run('CryptoUtils.encryptAESGCM / decryptAESGCM 暗号化テスト', async () => {
        const key = CryptoUtils.getRandomBytes(32);
        const iv = CryptoUtils.getRandomBytes(12);
        const plaintext = 'Hello, encrypted world!';
        const ciphertext = await CryptoUtils.encryptAESGCM(plaintext, key, iv);
        const decrypted = await CryptoUtils.decryptAESGCM(ciphertext, key, iv);
        test.assertEqual(decrypted, plaintext, '復号結果');
    });

    await test.run('CryptoUtils.hkdf 鍵導出テスト', async () => {
        const secret = CryptoUtils.getRandomBytes(32);
        const salt = CryptoUtils.getRandomBytes(16);
        const info = 'test-info';
        const derived = await CryptoUtils.hkdf(secret, salt, info, 32);
        test.assertEqual(derived.length, 32, '導出された鍵の長さ');
    });

    // ============================================
    // TLS 1.3 ハンドシェイクテスト
    // ============================================

    console.log('\n--- TLS 1.3 ハンドシェイクテスト ---\n');

    await test.run('TLS13Handshake.generateClientHello 生成テスト', async () => {
        const handshake = new TLS13Handshake();
        const clientHello = await handshake.generateClientHello();

        test.assertEqual(clientHello.version, '1.3', 'バージョン');
        test.assertEqual(clientHello.random.length, 64, 'ランダム値（32バイト=64文字）');
        test.assertEqual(clientHello.sessionId.length, 64, 'セッションID');
        test.assertTrue(clientHello.cipherSuites.length > 0, '暗号スイートが存在');
        test.assertTrue(clientHello.keyShare.keyExchange.length > 0, '鍵共有データが存在');
        test.assertEqual(handshake.state, 'CLIENT_HELLO_SENT', '状態');
    });

    await test.run('TLS13Handshake.processServerHello 完了テスト', async () => {
        const handshake = new TLS13Handshake();
        const clientHello = await handshake.generateClientHello();

        const serverHello = {
            version: '1.3',
            random: CryptoUtils.bytesToHex(CryptoUtils.getRandomBytes(32)),
            sessionId: clientHello.sessionId,
            cipherSuite: clientHello.cipherSuites[0],
            keyShare: CryptoUtils.bytesToHex(CryptoUtils.getRandomBytes(65))
        };

        const result = await handshake.processServerHello(
            serverHello,
            clientHello.keyShare.keyPair
        );

        test.assertTrue(result.success, '成功');
        test.assertEqual(handshake.state, 'HANDSHAKE_COMPLETE', '状態');
        test.assertTrue(result.masterSecret instanceof Uint8Array, 'マスターシークレット');
        test.assertTrue(result.cipherKeys.clientWriteKey instanceof Uint8Array, 'クライアント鍵');
        test.assertTrue(result.cipherKeys.serverWriteKey instanceof Uint8Array, 'サーバー鍵');
    });

    await test.run('TLS13Handshake.encryptMessage / decryptMessage テスト', async () => {
        const handshake = new TLS13Handshake();
        const clientHello = await handshake.generateClientHello();

        const serverHello = {
            version: '1.3',
            random: CryptoUtils.bytesToHex(CryptoUtils.getRandomBytes(32)),
            sessionId: clientHello.sessionId,
            cipherSuite: clientHello.cipherSuites[0],
            keyShare: CryptoUtils.bytesToHex(CryptoUtils.getRandomBytes(65))
        };

        await handshake.processServerHello(serverHello, clientHello.keyShare.keyPair);

        const message = 'Hello, TLS 1.3!';
        const encrypted = await handshake.encryptMessage(message);
        test.assertTrue(encrypted.iv, 'IVが存在');
        test.assertTrue(encrypted.ciphertext, '暗号文が存在');

        const decrypted = await handshake.decryptMessage(encrypted);
        test.assertEqual(decrypted, message, '復号結果');
    });

    // ============================================
    // Kerberos 風認証テスト
    // ============================================

    console.log('\n--- Kerberos 風認証テスト ---\n');

    await test.run('KerberosAuthenticator.authenticationServiceRequest 生成テスト', async () => {
        const kerberos = new KerberosAuthenticator();
        const asReq = await kerberos.authenticationServiceRequest('user123', 'user@example.com');

        test.assertEqual(asReq.pvno, 5, 'Kerberosバージョン');
        test.assertEqual(asReq.msgType, 'AS_REQ', 'メッセージタイプ');
        test.assertEqual(asReq.client.userId, 'user123', 'ユーザーID');
        test.assertEqual(asReq.client.userEmail, 'user@example.com', 'メールアドレス');
        test.assertEqual(asReq.realm, 'HEALTHSHARE.LOCAL', 'レルム');
        test.assertTrue(asReq.nonce.length > 0, 'ナンスが存在');
    });

    await test.run('KerberosAuthenticator.authenticationServiceReply 応答テスト', async () => {
        const kerberos = new KerberosAuthenticator();
        const asReq = await kerberos.authenticationServiceRequest('user123', 'user@example.com');
        const userPasswordHash = 'test-password-hash';

        const asRep = await kerberos.authenticationServiceReply(asReq, userPasswordHash);

        test.assertEqual(asRep.pvno, 5, 'Kerberosバージョン');
        test.assertEqual(asRep.msgType, 'AS_REP', 'メッセージタイプ');
        test.assertEqual(asRep.cname, 'user123', 'クライアント名');
        test.assertTrue(asRep.ticket, 'チケットが存在');
        test.assertTrue(asRep.key, '暗号化キーが存在');
    });

    await test.run('KerberosAuthenticator.generateTicket チケット生成テスト', async () => {
        const kerberos = new KerberosAuthenticator();
        const client = { userId: 'user123', userEmail: 'user@example.com' };
        const userPasswordHash = 'test-password-hash';

        const ticket = await kerberos.generateTicket(client, userPasswordHash);

        test.assertEqual(ticket.tktVno, 5, 'チケットバージョン');
        test.assertEqual(ticket.realm, 'HEALTHSHARE.LOCAL', 'レルム');
        test.assertTrue(ticket.encPart, '暗号化パートが存在');
        test.assertTrue(ticket.encPart.cipher, '暗号文が存在');
    });

    await test.run('KerberosAuthenticator 完全なTGSフローテスト', async () => {
        const kerberos = new KerberosAuthenticator();

        // AS_REQ/AS_REP
        const asReq = await kerberos.authenticationServiceRequest('user123', 'user@example.com');
        const userPasswordHash = 'test-password-hash';
        const asRep = await kerberos.authenticationServiceReply(asReq, userPasswordHash);

        // TGS_REQ/TGS_REP
        const tgt = asRep.ticket;
        const tgsReq = await kerberos.ticketGrantingServiceRequest(tgt, 'healthshare-api');
        const serviceKey = 'service-secret-key';
        const tgsRep = await kerberos.ticketGrantingServiceReply(tgsReq, serviceKey);

        test.assertTrue(tgsRep.ticket, 'サービスチケットが存在');
        test.assertTrue(tgsRep.key, 'セッションキーが存在');
    });

    await test.run('KerberosAuthenticator 相互認証（AP_REQ/AP_REP）テスト', async () => {
        const kerberos = new KerberosAuthenticator();

        // 完全なフロー
        const asReq = await kerberos.authenticationServiceRequest('user123', 'user@example.com');
        const asRep = await kerberos.authenticationServiceReply(asReq, 'password-hash');
        const tgsReq = await kerberos.ticketGrantingServiceRequest(asRep.ticket, 'api');
        const tgsRep = await kerberos.ticketGrantingServiceReply(tgsReq, 'service-key');

        // AP_REQ/AP_REP
        const sessionKey = 'session-key-123';
        const apReq = await kerberos.applicationRequest(tgsRep.ticket, sessionKey);
        const apRep = await kerberos.applicationReply(apReq, sessionKey);

        test.assertEqual(apReq.msgType, 'AP_REQ', 'AP_REQ メッセージタイプ');
        test.assertEqual(apRep.msgType, 'AP_REP', 'AP_REP メッセージタイプ');
        test.assertTrue(apRep.encPart, 'AP_REP 暗号化パート');
    });

    // ============================================
    // Challenge-Response 認証テスト
    // ============================================

    console.log('\n--- Challenge-Response 認証テスト ---\n');

    await test.run('ChallengeResponseAuth.generateChallenge 生成テスト', async () => {
        const crAuth = new ChallengeResponseAuth();
        const challenge = crAuth.generateChallenge('user123');

        test.assertEqual(challenge.userId, 'user123', 'ユーザーID');
        test.assertEqual(challenge.challenge.length, 64, 'チャレンジ（32バイト=64文字）');
        test.assertEqual(challenge.nonce.length, 32, 'ナンス（16バイト=32文字）');
        test.assertEqual(challenge.algorithm, 'HMAC-SHA256', 'アルゴリズム');
        test.assertTrue(challenge.expiry > Date.now(), '有効期限が未来');
    });

    await test.run('ChallengeResponseAuth.generateResponse 応答生成テスト', async () => {
        const crAuth = new ChallengeResponseAuth();
        const challenge = crAuth.generateChallenge('user123');
        const secret = 'user-secret-key';

        const response = await crAuth.generateResponse(challenge, secret);

        test.assertEqual(response.challenge, challenge.challenge, 'チャレンジ一致');
        test.assertEqual(response.nonce, challenge.nonce, 'ナンス一致');
        test.assertTrue(response.response.length > 0, 'レスポンスが存在');
        test.assertEqual(response.response.length, 64, 'HMAC-SHA256 署名（64文字）');
    });

    await test.run('ChallengeResponseAuth.verifyResponse 検証テスト（成功）', async () => {
        const crAuth = new ChallengeResponseAuth();
        const userId = 'user123';
        const secret = 'user-secret-key';

        const challenge = crAuth.generateChallenge(userId);
        const response = await crAuth.generateResponse(challenge, secret);

        const verification = await crAuth.verifyResponse(
            challenge.challenge,
            response.response,
            challenge.nonce,
            userId,
            secret
        );

        test.assertTrue(verification.valid, '検証成功');
    });

    await test.run('ChallengeResponseAuth.verifyResponse 検証テスト（失敗：異なる秘密鍵）', async () => {
        const crAuth = new ChallengeResponseAuth();
        const userId = 'user123';
        const secret = 'correct-secret';
        const wrongSecret = 'wrong-secret';

        const challenge = crAuth.generateChallenge(userId);
        const response = await crAuth.generateResponse(challenge, secret);

        const verification = await crAuth.verifyResponse(
            challenge.challenge,
            response.response,
            challenge.nonce,
            userId,
            wrongSecret
        );

        test.assertTrue(!verification.valid, '検証失敗');
        test.assertEqual(verification.reason, 'Response が一致しません', '理由');
    });

    await test.run('ChallengeResponseAuth.verifyResponse 検証テスト（失敗：無効なチャレンジ）', async () => {
        const crAuth = new ChallengeResponseAuth();
        const userId = 'user123';
        const secret = 'user-secret-key';

        const verification = await crAuth.verifyResponse(
            'invalid-challenge-hex',
            'some-response',
            'some-nonce',
            userId,
            secret
        );

        test.assertTrue(!verification.valid, '検証失敗');
        test.assertEqual(verification.reason, 'Challenge が見つかりません', '理由');
    });

    await test.run('ChallengeResponseAuth.verifyResponse 検証テスト（失敗：使用済みチャレンジ）', async () => {
        const crAuth = new ChallengeResponseAuth();
        const userId = 'user123';
        const secret = 'user-secret-key';

        const challenge = crAuth.generateChallenge(userId);
        const response = await crAuth.generateResponse(challenge, secret);

        // 1回目の検証（成功）
        const verification1 = await crAuth.verifyResponse(
            challenge.challenge,
            response.response,
            challenge.nonce,
            userId,
            secret
        );
        test.assertTrue(verification1.valid, '1回目検証成功');

        // 2回目の検証（失敗：使用済み）
        const verification2 = await crAuth.verifyResponse(
            challenge.challenge,
            response.response,
            challenge.nonce,
            userId,
            secret
        );
        test.assertTrue(!verification2.valid, '2回目検証失敗');
        test.assertEqual(verification2.reason, 'Challenge は既に使用されています', '理由');
    });

    await test.run('ChallengeResponseAuth.establishSessionKey セッションキー確立テスト', async () => {
        const crAuth = new ChallengeResponseAuth();
        const userId = 'user123';
        const secret = 'user-secret-key';

        const challenge = crAuth.generateChallenge(userId);
        const response = await crAuth.generateResponse(challenge, secret);

        const sessionResult = await crAuth.establishSessionKey(
            challenge,
            response.response,
            secret
        );

        test.assertTrue(sessionResult.success, '成功');
        test.assertEqual(sessionResult.sessionKey.length, 64, 'セッションキー（SHA-256）');
        test.assertTrue(sessionResult.expiry > Date.now(), '有効期限が未来');
    });

    await test.run('ChallengeResponseAuth.mutualChallengeResponse 相互認証テスト', async () => {
        const crAuth = new ChallengeResponseAuth();

        const result = await crAuth.mutualChallengeResponse(
            'client-id',
            'server-id',
            'shared-secret'
        );

        test.assertTrue(result.clientChallenge, 'クライアントチャレンジ');
        test.assertTrue(result.serverChallenge, 'サーバーチャレンジ');
        test.assertEqual(result.clientChallenge.userId, 'client-id', 'クライアントID');
        test.assertEqual(result.serverChallenge.userId, 'server-id', 'サーバーID');
    });

    // ============================================
    // 統合認証マネージャテスト
    // ============================================

    console.log('\n--- 統合認証マネージャテスト ---\n');

    await test.run('IntegratedAuthManager.fullAuthenticationFlow 完全な認証フローテスト', async () => {
        const authManager = new IntegratedAuthManager();
        const userId = 'test-user';
        const userEmail = 'test@example.com';
        const passwordHash = await CryptoUtils.sha256('test-password');

        const result = await authManager.fullAuthenticationFlow(userId, userEmail, passwordHash);

        test.assertTrue(result.success, '認証成功');
        test.assertEqual(result.steps.length, 4, '4つのステップ');
        test.assertEqual(result.steps[0], 'TLS 1.3 Handshake', 'ステップ1');
        test.assertEqual(result.steps[1], 'Kerberos Authentication', 'ステップ2');
        test.assertEqual(result.steps[2], 'Challenge-Response Authentication', 'ステップ3');
        test.assertEqual(result.steps[3], 'Session Key Establishment', 'ステップ4');
        test.assertTrue(result.sessionKey, 'セッションキー');
        test.assertTrue(result.ticket, 'チケット');
        test.assertTrue(result.sessionId, 'セッションID');
    });

    await test.run('IntegratedAuthManager.verifySession セッション検証テスト', async () => {
        const authManager = new IntegratedAuthManager();
        const userId = 'test-user';
        const userEmail = 'test@example.com';
        const passwordHash = await CryptoUtils.sha256('test-password');

        const authResult = await authManager.fullAuthenticationFlow(userId, userEmail, passwordHash);

        // 有効なセッション検証
        const validVerification = await authManager.verifySession(authResult.sessionId, userId);
        test.assertTrue(validVerification.valid, '有効なセッション');
        test.assertEqual(validVerification.session.userId, userId, 'ユーザーID一致');

        // 無効なセッションID
        const invalidVerification = await authManager.verifySession('invalid-session-id', userId);
        test.assertTrue(!invalidVerification.valid, '無効なセッション');

        // セッション終了
        await authManager.terminateSession(authResult.sessionId);
        const afterTerminate = await authManager.verifySession(authResult.sessionId, userId);
        test.assertTrue(!afterTerminate.valid, '終了後検証失敗');
    });

    await test.run('IntegratedAuthManager.getAuthenticationStatus 状態取得テスト', async () => {
        const authManager = new IntegratedAuthManager();

        const status = authManager.getAuthenticationStatus();

        test.assertTrue('activeSessions' in status, 'activeSessionsが存在');
        test.assertTrue('tlsState' in status, 'tlsStateが存在');
        test.assertTrue('ticketCacheSize' in status, 'ticketCacheSizeが存在');
        test.assertTrue('challengeStoreSize' in status, 'challengeStoreSizeが存在');
    });

    await test.run('IntegratedAuthManager.runAuthenticationDemo デモ実行テスト', async () => {
        const authManager = new IntegratedAuthManager();

        const result = await authManager.runAuthenticationDemo('demo-user', 'demo@example.com');

        test.assertTrue(result.success, 'デモ成功');
        test.assertEqual(result.steps.length, 4, '4つのステップ');
    });

    // ============================================
    // 統合テスト
    // ============================================

    console.log('\n--- 統合テスト ---\n');

    await test.run('完全な認証フロー統合テスト', async () => {
        const authManager = new IntegratedAuthManager();
        const userId = 'integration-test-user';
        const userEmail = 'integration@example.com';
        const passwordHash = await CryptoUtils.sha256('integration-password');

        // 1. 完全な認証フロー
        const authResult = await authManager.fullAuthenticationFlow(userId, userEmail, passwordHash);
        test.assertTrue(authResult.success, '認証成功');

        // 2. セッション検証
        const sessionValid = await authManager.verifySession(authResult.sessionId, userId);
        test.assertTrue(sessionValid.valid, 'セッション有効');

        // 3. 認証状態確認
        const status = authManager.getAuthenticationStatus();
        test.assertTrue(status.activeSessions >= 1, 'アクティブセッションあり');

        // 4. セッション終了
        const terminateResult = await authManager.terminateSession(authResult.sessionId);
        test.assertTrue(terminateResult.success, 'セッション終了成功');

        // 5. 終了後検証
        const afterTerminate = await authManager.verifySession(authResult.sessionId, userId);
        test.assertTrue(!afterTerminate.valid, '終了後無効');
    });

    // ============================================
    // 結果サマリー
    // ============================================

    const summary = test.summary();

    if (summary.failed === 0) {
        console.log('🎉 すべてのテストに合格しました！\n');
    } else {
        console.log('⚠️ 一部のテストが失敗しました。\n');
    }

    return summary;
}

// ============================================
// テスト実行（ブラウザ環境用）
// ============================================

if (typeof window !== 'undefined') {
    window.runTLSTests = runTests;
    console.log('📋 テストを実行するには: await window.runTLSTests()');
}

// Node.js 環境用のエクスポート
export { runTests };