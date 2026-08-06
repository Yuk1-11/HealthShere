# HealthShare Firestore データベース設計書

## 概要

HealthShare の Firestore データベース構造とデータモデルを定義します。

---

## コレクション構成

### 1. `users` コレクション

ユーザー情報を保存します。

#### ドキュメントID
- Firebase Authentication の UID と同一

#### フィールド構成

| フィールド名 | 型 | 説明 | サンプル値 |
|-------------|-----|------|-----------|
| `name` | string | ユーザー名 | "山田太郎" |
| `email` | string | メールアドレス | "taro@example.com" |
| `bio` | string \| null | 自己紹介 | "健康管理を頑張っています" |
| `isEmailVerified` | boolean | メール認証済み | true |
| `createdAt` | string (ISO) | 作成日時 | "2024-01-15T10:30:00.000Z" |
| `lastLoginAt` | string (ISO) \| null | 最終ログイン日時 | "2024-01-20T08:45:00.000Z" |
| `updatedAt` | string (ISO) | 更新日時 | "2024-01-20T08:45:00.000Z" |
| `profileImageUrl` | string \| null | プロフィール画像URL | "https://storage.googleapis.com/..." |

#### セキュリティルール
```javascript
match /users/{userId} {
  allow read, update, delete: if request.auth != null && request.auth.uid == userId;
  allow create: if request.auth != null && request.auth.uid == userId;
}
```

---

### 2. `heartRates` コレクション

心拍数データを保存します。

#### ドキュメントID
- 自動生成（ランダムID）

#### フィールド構成

| フィールド名 | 型 | 説明 | サンプル値 |
|-------------|-----|------|-----------|
| `userId` | string | ユーザーID | "abc123def456" |
| `heartRate` | number | 心拍数（bpm） | 72 |
| `timestamp` | timestamp | 計測日時 | Timestamp(2024-01-20T08:45:00) |
| `status` | string | 状態 | "normal" / "warning" / "danger" |
| `source` | string | データソース | "apple_watch" / "iphone" / "manual" |
| `createdAt` | timestamp | 作成日時 | Timestamp(2024-01-20T08:45:00) |

#### インデックス設定

| フィールド | 順序 | 目的 |
|-----------|------|------|
| `userId` | Ascending | ユーザー別フィルタ |
| `timestamp` | Descending | 時系列ソート |

**複合インデックス:**
- `userId` (Ascending) + `timestamp` (Descending) - 最新の心拍データを取得

#### セキュリティルール
```javascript
match /heartRates/{heartRateId} {
  allow read: if request.auth != null && 
    resource.data.userId == request.auth.uid;
  allow create: if request.auth != null && 
    request.resource.data.userId == request.auth.uid;
  allow update, delete: if false; // 心拍データは不変
}
```

---

### 3. `shareRequests` コレクション（将来拡張用）

ユーザー間の共有リクエストを管理します。

#### フィールド構成

| フィールド名 | 型 | 説明 |
|-------------|-----|------|
| `fromUserId` | string | リクエスト送信者ID |
| `toUserId` | string | リクエスト受信者ID |
| `toUserEmail` | string | 受信者のメールアドレス |
| `status` | string | "pending" / "accepted" / "rejected" |
| `createdAt` | timestamp | リクエスト日時 |
| `respondedAt` | timestamp \| null | 回答日時 |

---

### 4. `shareGroups` コレクション（将来拡張用）

共有グループを管理します。

#### フィールド構成

| フィールド名 | 型 | 説明 |
|-------------|-----|------|
| `name` | string | グループ名 |
| `ownerId` | string | 所有者ID |
| `memberIds` | array<string> | メンバーIDリスト |
| `createdAt` | timestamp | 作成日時 |

---

## データフロー

### 心拍データの保存フロー

```
Apple Watch
    ↓ (HealthKit)
iPhone App
    ↓ (Firebase SDK)
Firestore: heartRates コレクション
    ↓ (onSnapshot リスナー)
Web Dashboard (リアルタイム更新)
```

### クエリ例

#### 最新の心拍数を取得
```javascript
const q = query(
  collection(db, "heartRates"),
  where("userId", "==", userId),
  orderBy("timestamp", "desc"),
  limit(1)
);
```

#### 過去24時間のデータを取得
```javascript
const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

const q = query(
  collection(db, "heartRates"),
  where("userId", "==", userId),
  where("timestamp", ">=", yesterday),
  orderBy("timestamp", "desc")
);
```

#### リアルタイム購読
```javascript
const q = query(
  collection(db, "heartRates"),
  where("userId", "==", userId),
  orderBy("timestamp", "desc"),
  limit(1000)
);

const unsubscribe = onSnapshot(q, (snapshot) => {
  // リアルタイムでデータ更新
});
```

---

## データ保存のベストプラクティス

### 1. バッチ書き込み
複数の心拍データを一度に保存する場合はバッチ処理を使用：

```javascript
const batch = writeBatch(db);
const heartRateRef = collection(db, "heartRates");

data.forEach(d => {
  const docRef = doc(heartRateRef);
  batch.set(docRef, d);
});

await batch.commit();
```

### 2. サーバータイムスタンプ
クライアントの時刻ズレを防ぐため、可能であれば `serverTimestamp()` を使用：

```javascript
await setDoc(doc(heartRateRef), {
  userId: uid,
  heartRate: 72,
  timestamp: serverTimestamp(),
  // ...
});
```

### 3. データの削除ポリシー
- 心拍データ：30日間保持（必要に応じて延長）
- ユーザーデータ：アカウント削除時に完全削除

---

## Firestore ルール（全体）

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ユーザー情報
    match /users/{userId} {
      allow read, update: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow delete: if request.auth != null && request.auth.uid == userId;
    }
    
    // 心拍データ
    match /heartRates/{heartRateId} {
      allow read: if request.auth != null && 
        resource.data.userId == request.auth.uid;
      allow create: if request.auth != null && 
        request.resource.data.userId == request.auth.uid;
      allow update, delete: if false;
    }
    
    // 共有リクエスト
    match /shareRequests/{requestId} {
      allow read: if request.auth != null && 
        (resource.data.fromUserId == request.auth.uid || 
         resource.data.toUserId == request.auth.uid);
      allow create: if request.auth != null && 
        request.resource.data.fromUserId == request.auth.uid;
      allow update: if request.auth != null && 
        resource.data.toUserId == request.auth.uid;
    }
    
    // 共有グループ
    match /shareGroups/{groupId} {
      allow read: if request.auth != null && 
        resource.data.memberIds.hasAny([request.auth.uid]);
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && 
        resource.data.ownerId == request.auth.uid;
    }
  }
}
```

---

## 初期セットアップ手順

1. Firebase コンソールで Firestore データベースを作成
2. 上記のセキュリティルールを適用
3. 必要なインデックスを手動で作成
4. 環境変数に Firebase 設定を追加

---

## 注意事項

- 心拍データは医療機器ではないため、参考情報として扱う
- 大量の書き込みが発生する可能性があるため、レート制限を適切に設定
- プライバシー保護のため、ユーザーデータの適切な管理が重要

---

## セキュリティコレクション（新規追加）

### 5. `security` コレクション

ユーザーの高度なセキュリティ設定を保存します。

#### ドキュメントID
- Firebase Authentication の UID と同一

#### フィールド構成

| フィールド名 | 型 | 説明 | サンプル値 |
|-------------|-----|------|-----------|
| `userId` | string | ユーザーID | "abc123def456" |
| `userEmail` | string | メールアドレス | "user@example.com" |
| `salt` | string | パスワードソルト（16進数） | "a1b2c3d4..." |
| `algorithms` | array<string> | 利用可能なアルゴリズム | ["SHA-256", "SHA-512", "PBKDF2"] |
| `otpEnabled` | boolean | OTP 有効フラグ | false |
| `gssApiEnabled` | boolean | GSS-API 有効フラグ | false |
| `transactionSigningEnabled` | boolean | トランザクション署名有効フラグ | false |
| `passwordHash` | string \| null | パスワードハッシュ（16進数） | "e3b0c44298..." |
| `passwordSalt` | string \| null | パスワードソルト | "a1b2c3d4..." |
| `passwordIterations` | number \| null | PBKDF2 イテレーション数 | 100000 |
| `passwordAlgorithm` | string \| null | パスワードアルゴリズム | "PBKDF2-SHA256" |
| `otpSecret` | string \| null | OTP シークレットキー | "JBSWY3DPEHPK3PXP" |
| `currentTokenExpiry` | number \| null | 現在のGSSトークン有効期限 | 1705315200000 |
| `createdAt` | string (ISO) | 作成日時 | "2024-01-15T10:30:00.000Z" |
| `lastSecurityUpdate` | string (ISO) | 最終セキュリティ更新日時 | "2024-01-20T08:45:00.000Z" |
| `lastPasswordChange` | string (ISO) \| null | 最終パスワード変更日時 | "2024-01-20T08:45:00.000Z" |
| `lastTokenGenerated` | string (ISO) \| null | 最終トークン生成日時 | "2024-01-20T08:45:00.000Z" |
| `transactionSigningEnabledAt` | string (ISO) \| null | トランザクション署名有効化日時 | "2024-01-20T08:45:00.000Z" |

#### セキュリティルール
```javascript
match /security/{userId} {
  allow read, update: if request.auth != null && request.auth.uid == userId;
  allow create: if request.auth != null && request.auth.uid == userId;
  allow delete: if false; // セキュリティデータは削除不可
}
```

---

### 6. `security_logs` コレクション

セキュリティ関連の監査ログを保存します。

#### ドキュメントID
- 自動生成（`${userId}_${timestamp}`）

#### フィールド構成

| フィールド名 | 型 | 説明 | サンプル値 |
|-------------|-----|------|-----------|
| `userId` | string | ユーザーID | "abc123def456" |
| `eventType` | string | イベントタイプ | "PASSWORD_CHANGE", "OTP_VERIFY", "TOKEN_GENERATE" |
| `details` | map | イベント詳細 | { "ipAddress": "192.168.1.1" } |
| `timestamp` | string (ISO) | 発生日時 | "2024-01-20T08:45:00.000Z" |
| `ipAddress` | string \| null | IPアドレス | "192.168.1.1" |
| `userAgent` | string | ユーザーエージェント | "Mozilla/5.0..." |

#### セキュリティルール
```javascript
match /security_logs/{logId} {
  allow read: if request.auth != null && 
    resource.data.userId == request.auth.uid;
  allow create: if request.auth != null && 
    request.resource.data.userId == request.auth.uid;
  allow update, delete: if false; // 監査ログは不変
}
```

---

### 7. `transaction_signatures` コレクション

OTP トランザクション署名の履歴を保存します。

#### ドキュメントID
- 自動生成（ランダムID）

#### フィールド構成

| フィールド名 | 型 | 説明 | サンプル値 |
|-------------|-----|------|-----------|
| `userId` | string | ユーザーID | "abc123def456" |
| `userEmail` | string | メールアドレス | "user@example.com" |
| `version` | string | 署名バージョン | "1.0" |
| `otpToken` | string | OTP トークン | "123456" |
| `timestamp` | number | 署名日時（ミリ秒） | 1705315200000 |
| `expiry` | number | 有効期限（ミリ秒） | 1705315500000 |
| `nonce` | string | ナンス | "abc123..." |
| `signature` | string | 署名（16進数） | "e3b0c44298..." |
| `verified` | boolean | 検証済みフラグ | false |
| `createdAt` | timestamp | 作成日時 | Timestamp(2024-01-20T08:45:00) |

#### セキュリティルール
```javascript
match /transaction_signatures/{signatureId} {
  allow read: if request.auth != null && 
    resource.data.userId == request.auth.uid;
  allow create: if request.auth != null && 
    request.resource.data.userId == request.auth.uid;
  allow update, delete: if false; // 署名データは不変
}
```

---

## 高度なセキュリティ機能

### OTP トランザクション署名フロー

```
ユーザー認証
    ↓
OTP トークン入力
    ↓
トランザクション署名生成（OTPTransactionSigner）
    ↓
署名を検証・保存
    ↓
セキュリティログ記録
```

### GSS-API 風トークンフロー

```
ユーザー認証
    ↓
権限リクエスト
    ↓
GSS-API トークン生成（GSSAPITokenManager）
    ↓
トークン署名・エンコード
    ↓
クライアントにトークン返却
    ↓
以降のリクエストでトークン使用
```

### パスワードハッシュフロー

```
パスワード入力
    ↓
ランダムソルト生成
    ↓
PBKDF2-SHA256 でハッシュ（100,000 イテレーション）
    ↓
ハッシュ・ソルトを保存
    ↓
認証時に再ハッシュして比較
```
