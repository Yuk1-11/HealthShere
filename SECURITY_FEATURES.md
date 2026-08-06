# HealthShare 高度なセキュリティ機能

## 概要

HealthShare では、ユーザーのセキュリティを強化するために、以下の高度なセキュリティ機能を実装しています：

1. **OTP トランザクション署名** - ユーザーIDとメールアドレスをOTPトークンで署名
2. **SHA-2 パスワードハッシュ** - SHA-256、SHA-512、PBKDF2 によるパスワード保護
3. **GSS-API 風認証トークン** - RFC3645/GSS-API 風の認証メカニズム
4. **TLS 1.3 ハンドシェイク** - 現代的な暗号化通信プロトコル
5. **Kerberos 風認証** - チケットベースの相互認証システム
6. **Challenge-Response 認証** - リプレイ攻撃対策付き認証

---

## 1. OTP トランザクション署名

### 概要

OTP（One-Time Password）トークンを使用して、ユーザーIDとメールアドレスのトランザクションにデジタル署名を付与します。これにより、トランザクションの真正性と完全性を保証します。

### 仕組み

1. ユーザーが6桁のOTPコードを入力
2. システムが署名データを生成：
   - バージョン情報
   - ユーザーID
   - メールアドレス
   - OTPトークン
   - タイムスタンプ
   - 有効期限（5分）
   - ナンス（ランダム値）
3. HMAC-SHA256を使用して署名を生成
4. 署名をFirestoreに保存し、監査証跡を記録

### 使用例

```javascript
import { OTPTransactionSigner } from './security-advanced.js';

// 署名生成
const signature = await OTPTransactionSigner.generateTransactionSignature(
    'user123',
    'user@example.com',
    '123456' // OTPトークン
);

console.log('署名データ:', signature.data);
console.log('署名ハッシュ:', signature.signature);

// 署名検証
const result = await OTPTransactionSigner.verifySignature(
    'user123',
    'user@example.com',
    signature.data,
    signature.signature
);

console.log('検証結果:', result.valid); // true/false
```

### セキュリティ上の利点

- **真正性**: 署名者が確かにそのユーザーであることを証明
- **完全性**: データが改ざんされていないことを保証
- **否認防止**: 後からトランザクションを否認できない
- **有効期限**: 5分間のみの有効性でリプレイ攻撃を防止

---

## 2. SHA-2 パスワードハッシュ

### 概要

パスワードを安全に保存するために、SHA-256、SHA-512、またはPBKDF2アルゴリズムを使用してハッシュ化します。

### サポートされているアルゴリズム

#### SHA-256
- 256ビット（32バイト）のハッシュ値を生成
- 高速な処理が可能
- 一般的な用途に適している

#### SHA-512
- 512ビット（64バイト）のハッシュ値を生成
- SHA-256より高いセキュリティ
- より長いハッシュ値が必要な場合に使用

#### PBKDF2（推奨）
- Password-Based Key Derivation Function 2
- 100,000回のイテレーションでソルティング
- 総当たり攻撃に対して最も耐性がある
- 最新のセキュリティベストプラクティスに準拠

### 仕組み

1. ランダムなソルト（32バイト）を生成
2. パスワードとソルトを組み合わせてハッシュ化
3. ハッシュ値、ソルト、アルゴリズム情報を保存
4. 認証時に同じプロセスで再ハッシュして比較

### 使用例

```javascript
import { SHA2PasswordHasher } from './security-advanced.js';

// ソルト生成
const salt = SHA2PasswordHasher.generateSalt();

// SHA-256でハッシュ
const sha256Result = await SHA2PasswordHasher.hashSHA256('password123', salt);
console.log('SHA-256ハッシュ:', sha256Result.hash);
console.log('ソルト:', sha256Result.salt);

// SHA-512でハッシュ
const sha512Result = await SHA2PasswordHasher.hashSHA512('password123', salt);
console.log('SHA-512ハッシュ:', sha512Result.hash);

// PBKDF2でハッシュ（推奨）
const pbkdf2Result = await SHA2PasswordHasher.hashPBKDF2('password123', salt);
console.log('PBKDF2ハッシュ:', pbkdf2Result.hash);
console.log('イテレーション数:', pbkdf2Result.iterations);

// パスワード検証
const isValid = await SHA2PasswordHasher.verifyPassword(
    'password123',
    storedHash,
    storedSalt,
    'SHA-256'
);
console.log('パスワード有効:', isValid);
```

### セキュリティ上の利点

- **ソルティング**: 各パスワードに固有のソルトを使用
- **レインボーテーブル攻撃対策**: ソルトにより事前計算テーブルが無効化
- **総当たり攻撃対策**: PBKDF2の多数のイテレーションで攻撃を遅延
- **一方向性**: ハッシュから元のパスワードを復元不可

---

## 3. GSS-API 風認証トークン

### 概要

RFC3645（GSS-API Kerberos SASL Mechanism）にインスパイアされた認証トークンシステムです。権限情報を含む署名付きトークンを生成・検証します。

### トークン構造

```json
{
  "version": 1,
  "type": "GSS-API",
  "userId": "user123",
  "userEmail": "user@example.com",
  "permissions": ["read", "write", "profile_update"],
  "issuedAt": 1705315200000,
  "expiry": 1705318800000,
  "nonce": "random16bytes",
  "signature": "hmac-sha256-signature"
}
```

### 仕組み

1. トークンペイロードを構築（ユーザー情報、権限、有効期限など）
2. HMAC-SHA256で署名を生成
3. 全体をBase64エンコードしてトークン文字列を作成
4. トークン検証時に署名と有効期限をチェック

### 使用例

```javascript
import { GSSAPITokenManager } from './security-advanced.js';

// トークン生成
const result = await GSSAPITokenManager.generateToken(
    'user123',
    'user@example.com',
    ['read', 'write', 'admin']
);

console.log('トークン文字列:', result.tokenString);
console.log('有効期限:', new Date(result.token.expiry));

// トークン検証
const verification = await GSSAPITokenManager.verifyToken(
    result.tokenString,
    'user123',
    'user@example.com'
);

if (verification.valid) {
    console.log('トークン有効');
    const permissions = GSSAPITokenManager.getPermissions(verification.token);
    console.log('権限:', permissions);
} else {
    console.log('トークン無効:', verification.reason);
}
```

### セキュリティ上の利点

- **署名付き**: トークンの改ざんを検出可能
- **有効期限**: 1時間の有効期限でセキュリティを確保
- **権限管理**: トークンに権限情報を含めて細かいアクセス制御
- **ナンス**: リプレイ攻撃を防止するランダム値

---

## 4. セキュリティマネージャー

### 概要

`SecurityManager`クラスは、上記のすべてのセキュリティ機能を統合管理するためのインターフェースを提供します。

### 主な機能

#### ユーザーセキュリティ設定の初期化

```javascript
import { SecurityManager } from './security-advanced.js';

const securityManager = new SecurityManager();

// ユーザーのセキュリティ設定を初期化
await securityManager.initializeUserSecurity(
    'user123',
    'user@example.com'
);
```

#### パスワードの安全な保存

```javascript
// パスワードをハッシュ化して保存
await securityManager.hashAndStorePassword('user123', 'securePassword123');

// パスワードを検証
const result = await securityManager.verifyPassword('user123', 'securePassword123');
console.log('パスワード有効:', result.valid);
```

#### OTP トランザクション署名の有効化

```javascript
// OTP トランザクション署名を有効化
await securityManager.enableOTPTransactionSigning(
    'user123',
    'user@example.com',
    otpSecret
);

// トランザクション署名を生成
const signature = await securityManager.createTransactionSignature(
    'user123',
    'user@example.com',
    '123456' // OTPトークン
);
```

#### GSS-API トークンの生成

```javascript
// GSS-API トークンを生成
const tokenResult = await securityManager.generateGSSAPIToken(
    'user123',
    'user@example.com',
    ['read', 'write', 'delete']
);

console.log('トークン:', tokenResult.tokenString);
```

#### セキュリティ監査ログ

```javascript
// セキュリティイベントを記録
await securityManager.logSecurityEvent(
    'user123',
    'PASSWORD_CHANGE',
    {
        ipAddress: '192.168.1.1',
        userAgent: navigator.userAgent
    }
);
```

## 4. TLS 1.3 ハンドシェイク

### 概要

TLS 1.3（Transport Layer Security 1.3）は、最新の暗号化通信プロトコルです。HealthShare では、TLS 1.3 のハンドシェイクメカニズムをクライアントサイドで実装し、安全な通信チャネルの確立をシミュレートします。

### 特徴

- **1-RTT ハンドシェイク**: 従来の TLS 1.2 よりも高速な接続確立
- **前方秘匿性**: 各セッションで一意の鍵を生成
- **強力な暗号スイート**: AES-256-GCM、ChaCha20-Poly1305 などの現代的な暗号
- **安全な鍵交換**: ECDH（楕円曲線Diffie-Hellman）による鍵共有

### ハンドシェイクフロー

```
クライアント                          サーバー
    |                                    |
    |-------- ClientHello ------------>|
    |        (supported groups,         |
    |         key share)                |
    |                                    |
    |<------- ServerHello -------------|
    |        (chosen group,             |
    |         key share)                |
    |                                    |
    |-------- Encrypted --------->|
    |        Finished                 |
    |                                    |
    |<------- Encrypted --------------|
    |        Finished                 |
    |                                    |
    |===== 暗号化通信確立 =============|
```

### 使用例

```javascript
import { TLS13Handshake, CryptoUtils } from './tls13-kerberos.js';

// ハンドシェイクの初期化
const handshake = new TLS13Handshake();

// ClientHello 生成
const clientHello = await handshake.generateClientHello();
console.log('ClientHello:', clientHello);

// サーバー応答をシミュレート（実際にはサーバーから受信）
const serverHello = {
    version: '1.3',
    random: CryptoUtils.bytesToHex(CryptoUtils.getRandomBytes(32)),
    sessionId: clientHello.sessionId,
    cipherSuite: clientHello.cipherSuites[0],
    keyShare: CryptoUtils.bytesToHex(CryptoUtils.getRandomBytes(65))
};

// ハンドシェイク完了
const result = await handshake.processServerHello(
    serverHello,
    clientHello.keyShare.keyPair
);

if (result.success) {
    console.log('TLS ハンドシェイク完了！');
    console.log('マスターシークレット:', result.masterSecret);
    
    // 暗号化通信
    const encrypted = await handshake.encryptMessage('Hello, World!');
    console.log('暗号化メッセージ:', encrypted);
    
    // 復号
    const decrypted = await handshake.decryptMessage(encrypted);
    console.log('復号メッセージ:', decrypted);
}
```

### サポートされている暗号スイート

| 暗号スイート | 鍵長 | 説明 |
|-------------|------|------|
| TLS_AES_256_GCM_SHA384 | 256ビット | AES-256-GCM + SHA384 |
| TLS_CHACHA20_POLY1305_SHA256 | 256ビット | ChaCha20-Poly1305 + SHA256 |
| TLS_AES_128_GCM_SHA256 | 128ビット | AES-128-GCM + SHA256 |

### セキュリティ上の利点

- **前方秘匿性**: 長期鍵が漏洩しても過去の通信は安全
- **ダウングレード攻撃対策**: プロトコルバージョンの改ざんを検出
- **0-RTT 除外**: リプレイ攻撃のリスクを回避
- **強力な暗号**: 現代の攻撃に耐性のある暗号のみをサポート

---

## 5. Kerberos 風認証システム

### 概要

Kerberos は、チケットベースの相互認証プロトコルです。HealthShare では、Kerberos V5 にインスパイアされた認証システムを実装し、安全なサービスアクセスを提供します。

### Kerberos フロー

```
クライアント              KDC（認証サーバー）        サービス
    |                          |                      |
    |------ AS_REQ ---------->|                      |
    |      (ユーザーID)        |                      |
    |                          |                      |
    |<----- AS_REP -----------|                      |
    |      (TGT + セッションキー)|                      |
    |                          |                      |
    |------ TGS_REQ --------->|                      |
    |      (TGT + 認証子)      |                      |
    |                          |                      |
    |<----- TGS_REP ----------|                      |
    |      (サービスチケット)   |                      |
    |                          |                      |
    |------ AP_REQ ------------------------------->|
    |      (サービスチケット + 認証子)              |
    |                          |                      |
    |<----- AP_REP -------------------------------|
    |      (相互認証完了)                            |
    |                          |                      |
    |====== 安全な通信確立 ========================|
```

### チケット構造

```json
{
  "tktVno": 5,
  "realm": "HEALTHSHARE.LOCAL",
  "sname": {
    "nameType": "SRV_INST",
    "nameString": ["krbtgt", "HEALTHSHARE.LOCAL"]
  },
  "encPart": {
    "etype": "aes256-cts-hmac-sha1-96",
    "cipher": {
      "iv": "initialization-vector",
      "data": "encrypted-data"
    }
  },
  "timestamp": 1705315200000
}
```

### 使用例

```javascript
import { KerberosAuthenticator } from './tls13-kerberos.js';

const kerberos = new KerberosAuthenticator();

// 1. 認証サーバー要求（AS_REQ）
const asReq = await kerberos.authenticationServiceRequest(
    'user123',
    'user@example.com'
);
console.log('AS_REQ:', asReq);

// 2. 認証サーバー応答（AS_REP）- サーバーサイド
const userPasswordHash = 'user-password-hash';
const asRep = await kerberos.authenticationServiceReply(asReq, userPasswordHash);
console.log('AS_REP:', asRep);

// 3. TGT を使用してサービスチケットを要求（TGS_REQ）
const tgt = asRep.ticket;
const tgsReq = await kerberos.ticketGrantingServiceRequest(tgt, 'healthshare-api');
console.log('TGS_REQ:', tgsReq);

// 4. サービスチケット応答（TGS_REP）
const serviceKey = 'service-secret-key';
const tgsRep = await kerberos.ticketGrantingServiceReply(tgsReq, serviceKey);
console.log('TGS_REP:', tgsRep);

// 5. サービス要求（AP_REQ）- 相互認証
const serviceTicket = tgsRep.ticket;
const sessionKey = 'session-key-from-tgs';
const apReq = await kerberos.applicationRequest(serviceTicket, sessionKey);
console.log('AP_REQ:', apReq);

// 6. サービス応答（AP_REP）- 相互認証完了
const apRep = await kerberos.applicationReply(apReq, sessionKey);
console.log('AP_REP:', apRep);
```

### セキュリティ上の利点

- **相互認証**: クライアントとサーバーが互いに認証
- **シングルサインオン**: 1回のログインで複数サービスにアクセス
- **チケットベース**: パスワードをネットワーク経由で送信しない
- **セッションキー**: 各セッションで一意の暗号鍵を使用
- **有効期限**: チケットには有効期限があり、自動無効化

---

## 6. Challenge-Response 認証

### 概要

Challenge-Response 認証は、サーバーがクライアントにランダムな課題（Challenge）を送信し、クライアントが秘密鍵を使用して応答（Response）を返す認証方式です。リプレイ攻撃に対する強力な耐性を持ちます。

### 認証フロー

```
クライアント                          サーバー
    |                                    |
    |<------- Challenge ----------------|
    |        (random bytes,              |
    |         nonce, expiry)             |
    |                                    |
    |-------- Response --------------->|
    |         (HMAC(Challenge +          |
    |          Nonce + Secret))          |
    |                                    |
    |<------- Verification Result ------|
    |                                    |
    |====== 認証完了 ===================|
```

### Challenge 構造

```json
{
  "challenge": "random-32-bytes-hex",
  "nonce": "random-16-bytes-hex",
  "timestamp": 1705315200000,
  "expiry": 1705315500000,
  "userId": "user123",
  "algorithm": "HMAC-SHA256"
}
```

### Response 生成

```
Response = HMAC-SHA256(
    Secret,
    Challenge + ":" + Nonce + ":" + Secret
)
```

### 使用例

```javascript
import { ChallengeResponseAuth, CryptoUtils } from './tls13-kerberos.js';

const crAuth = new ChallengeResponseAuth();
const userId = 'user123';
const secret = 'user-secret-key';

// 1. サーバーが Challenge 生成
const challenge = crAuth.generateChallenge(userId);
console.log('Challenge:', challenge);

// 2. クライアントが Response 生成
const response = await crAuth.generateResponse(challenge, secret);
console.log('Response:', response);

// 3. サーバーが Response 検証
const verification = await crAuth.verifyResponse(
    challenge.challenge,
    response.response,
    challenge.nonce,
    userId,
    secret
);

console.log('検証結果:', verification);
// { valid: true } または { valid: false, reason: '...' }

// 4. セッションキー確立
const sessionResult = await crAuth.establishSessionKey(
    challenge,
    response.response,
    secret
);

console.log('セッションキー:', sessionResult.sessionKey);
console.log('有効期限:', new Date(sessionResult.expiry));
```

### 相互認証（Mutual Authentication）

```javascript
// クライアントとサーバーが互いに認証
const mutualResult = await crAuth.mutualChallengeResponse(
    'client-id',
    'server-id',
    'shared-secret'
);

console.log('相互認証:', mutualResult);
// クライアントとサーバー両方からの Challenge が生成される
```

### セキュリティ上の利点

- **リプレイ攻撃対策**: 各 Challenge は1回限り + 有効期限付き
- **Nonce 使用**: 同一 Challenge での再利用を防止
- **HMAC 署名**: 秘密鍵を知っていることを証明
- **有効期限**: 5分間の有効期限で時間制限
- **相互認証**: 双方向の認証が可能

---

## 7. 統合認証マネージャー

### 概要

`IntegratedAuthManager` は、TLS 1.3 ハンドシェイク、Kerberos 認証、Challenge-Response 認証を統合した完全な認証フローを提供します。

### 完全な認証フロー

```
1. TLS 1.3 ハンドシェイク
   ↓
2. Kerberos 認証（TGT 取得）
   ↓
3. Challenge-Response 認証
   ↓
4. セッションキー確立
   ↓
5. 安全なセッション開始
```

### 使用例

```javascript
import { IntegratedAuthManager, AuthRecordManager } from './tls13-kerberos.js';

const authManager = new IntegratedAuthManager();
const recordManager = new AuthRecordManager();

// 完全な認証フローの実行
const result = await authManager.fullAuthenticationFlow(
    'user123',
    'user@example.com',
    'password-hash-here'
);

console.log('認証フロー結果:', result);
/*
{
  steps: [
    'TLS 1.3 Handshake',
    'Kerberos Authentication',
    'Challenge-Response Authentication',
    'Session Key Establishment'
  ],
  success: true,
  sessionKey: '...',
  ticket: { ... },
  sessionId: '...'
}
*/

// セッション検証
const verification = await authManager.verifySession(result.sessionId, 'user123');
console.log('セッション検証:', verification);

// 認証状態の取得
const status = authManager.getAuthenticationStatus();
console.log('認証状態:', status);
/*
{
  activeSessions: 1,
  tlsState: 'HANDSHAKE_COMPLETE',
  ticketCacheSize: 1,
  challengeStoreSize: 0
}
*/

// セッション終了
await authManager.terminateSession(result.sessionId);

// 認証記録
await recordManager.logAuthenticationAttempt('user123', result.success, {
  method: 'TLS13_KERBEROS_CHALLENGE',
  duration: '...'
});
```

### 認証記録管理

```javascript
// 認証試行の記録
await recordManager.logAuthenticationAttempt('user123', true, {
  authMethod: 'TLS13_KERBEROS_CHALLENGE'
});

// セッション確立の記録
await recordManager.logSessionEstablishment(sessionId, 'user123', sessionData);

// セッション終了の記録
await recordManager.logSessionTermination(sessionId, 'user_logout');
```

---

## 8. Firestore コレクション構造

### security コレクション

ユーザーの高度なセキュリティ設定を保存します。

```javascript
{
  userId: "user123",
  userEmail: "user@example.com",
  salt: "a1b2c3d4...",
  algorithms: ["SHA-256", "SHA-512", "PBKDF2"],
  otpEnabled: false,
  gssApiEnabled: false,
  transactionSigningEnabled: false,
  passwordHash: "e3b0c44298...",
  passwordSalt: "a1b2c3d4...",
  passwordIterations: 100000,
  passwordAlgorithm: "PBKDF2-SHA256",
  otpSecret: "JBSWY3DPEHPK3PXP",
  createdAt: "2024-01-15T10:30:00.000Z",
  lastSecurityUpdate: "2024-01-20T08:45:00.000Z"
}
```

### security_logs コレクション

セキュリティ関連の監査ログを保存します。

```javascript
{
  userId: "user123",
  eventType: "PASSWORD_CHANGE",
  details: { "ipAddress": "192.168.1.1" },
  timestamp: "2024-01-20T08:45:00.000Z",
  userAgent: "Mozilla/5.0..."
}
```

### transaction_signatures コレクション

OTP トランザクション署名の履歴を保存します。

```javascript
{
  userId: "user123",
  userEmail: "user@example.com",
  version: "1.0",
  otpToken: "123456",
  timestamp: 1705315200000,
  expiry: 1705315500000,
  nonce: "abc123...",
  signature: "e3b0c44298...",
  verified: true,
  createdAt: "2024-01-20T08:45:00.000Z"
}
```

---

## 6. セキュリティベストプラクティス

### パスワードポリシー

- 最低8文字以上
- 大文字・小文字・数字・特殊文字を含む
- 一般的なパスワード（password, 123456など）は使用不可
- 定期的なパスワード変更を推奨

### 二要素認証（2FA）

- TOTP（Time-based One-Time Password）をサポート
- バックアップコードを提供
- 再認証を要求する重要な操作

### レート制限

- ログイン試行：5回/15分
- 登録試行：3回/15分
- メール送信：3回/60分

### 監査ログ

- すべてのセキュリティ関連イベントを記録
- 不審なアクティビティの検出
- コンプライアンス要件への対応

---

## 7. 注意事項

### クライアントサイドの制限

この実装はクライアントサイド（ブラウザー）で動作するため、以下の点に注意が必要です：

1. **シークレットキーの保護**: クライアントサイドでは完全な秘密性を保証できません
2. **サーバーサイド検証**: 重要な検証はサーバーサイドでも実施すべきです
3. **HTTPSの必須化**: 本番環境では必ずHTTPSを使用してください

### 推奨事項

1. **サーバーサイド実装**: 本番環境では、重要なセキュリティ機能をサーバーサイドで実装
2. **定期的なセキュリティ監査**: コードと設定の定期的な見直し
3. **依存関係の更新**: 使用するライブラリを最新に保つ
4. **セキュリティヘッダー**: 適切なHTTPセキュリティヘッダーを設定

---

## 8. 参考資料

### 認証プロトコル

- [RFC 4226: HOTP Algorithm](https://tools.ietf.org/html/rfc4226)
- [RFC 6238: TOTP Algorithm](https://tools.ietf.org/html/rfc6238)
- [RFC 3645: GSS-API SASL Mechanism](https://tools.ietf.org/html/rfc3645)
- [RFC 4120: Kerberos V5](https://tools.ietf.org/html/rfc4120)
- [RFC 8446: TLS 1.3](https://tools.ietf.org/html/rfc8446)
- [RFC 5246: TLS 1.2](https://tools.ietf.org/html/rfc5246)

### セキュリティベストプラクティス

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

### 暗号化 API

- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [SubtleCrypto Interface](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)

---

## 9. サポート

セキュリティに関する問題や質問は、以下の連絡先までお知らせください：

- GitHub Issues: [HealthShare Issues](https://github.com/Yuk1-11/yuki_py_1/issues)
- セキュリティレポート: security@healthshare.example.com

---

**最終更新日**: 2024年1月20日