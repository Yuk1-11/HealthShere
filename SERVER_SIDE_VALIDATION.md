# HealthShare サーバーサイド検証実装ガイド

## 概要

このドキュメントでは、HealthShare プロジェクトに実装されたサーバーサイド検証機能について説明します。

## 実装された機能

### 1. Firebase Cloud Functions

`functions/` ディレクトリに Firebase Cloud Functions を実装しました。

#### 主な関数

| 関数名 | 説明 |
|--------|------|
| `saveHeartRate` | 心拍数データをサーバーサイド検証付きで保存 |
| `updateUserProfile` | ユーザープロフィール更新（XSS対策付き） |
| `changePassword` | パスワード変更（bcryptハッシュ化） |
| `sendShareRequest` | 共有リクエスト送信 |
| `respondToShareRequest` | 共有リクエスト応答 |
| `initializeSecuritySettings` | ユーザー作成時にセキュリティ設定を初期化 |
| `cleanupUserData` | ユーザー削除時にデータをクリーンアップ |
| `securityAudit` | 定期的なセキュリティ監査（24時間ごと） |
| `detectSuspiciousActivity` | 異常なアカウント作成の検出 |

### 2. セキュリティミドルウェア

- **認証検証**: Firebase ID トークンの検証
- **レート制限**: 15分間に100リクエストまで
- **入力値検証**: Joi を使った厳格なバリデーション

### 3. セキュリティ監査ログ

すべての重要な操作が `security_logs` コレクションに記録されます。

記録されるイベント:
- `PROFILE_UPDATE` - プロフィール更新
- `PASSWORD_CHANGE` - パスワード変更
- `SHARE_REQUEST_SENT` - 共有リクエスト送信
- `SHARE_REQUEST_RESPONDED` - 共有リクエスト応答
- `ABNORMAL_HEART_RATE` - 異常な心拍数検出
- `SUSPICIOUS_ACTIVITY` - 不審なアクティビティ

## セットアップ手順

### ステップ 1: Firebase CLI のインストール

```bash
npm install -g firebase-tools
```

### ステップ 2: Firebase ログイン

```bash
firebase login
```

### ステップ 3: プロジェクト初期化

```bash
cd functions
npm install
cd ..
```

### ステップ 4: Firebase 設定

```bash
firebase init
```

以下のオプションを選択:
- Firestore
- Functions
- Hosting（オプション）

### ステップ 5: 環境変数の設定

`.env` ファイルを作成（`functions/` ディレクトリ内）:

```env
# 必要な環境変数をここに追加
```

### ステップ 6: デプロイ

```bash
firebase deploy --only functions,firestore
```

### ステップ 7: ローカルテスト

```bash
cd functions
npm run serve
```

## クライアントサイド統合

### 心拍数データの保存（サーバーサイド検証付き）

```javascript
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const saveHeartRate = httpsCallable(functions, 'saveHeartRate');

try {
  const result = await saveHeartRate({
    heartRate: 72,
    timestamp: Date.now(),
    source: 'apple_watch'
  });
  
  console.log('Result:', result.data);
} catch (error) {
  console.error('Error:', error);
}
```

### プロフィール更新

```javascript
const updateUserProfile = httpsCallable(functions, 'updateUserProfile');

try {
  const result = await updateUserProfile({
    name: '山田太郎',
    bio: '健康管理を頑張っています'
  });
  
  console.log('Result:', result.data);
} catch (error) {
  console.error('Error:', error);
}
```

### パスワード変更

```javascript
const changePassword = httpsCallable(functions, 'changePassword');

try {
  const result = await changePassword({
    currentPassword: 'currentPassword123',
    newPassword: 'newSecurePassword123!'
  });
  
  console.log('Result:', result.data);
} catch (error) {
  console.error('Error:', error);
}
```

### 共有リクエスト送信

```javascript
const sendShareRequest = httpsCallable(functions, 'sendShareRequest');

try {
  const result = await sendShareRequest({
    toUserEmail: 'friend@example.com',
    message: '心拍数を共有しませんか？'
  });
  
  console.log('Result:', result.data);
} catch (error) {
  console.error('Error:', error);
}
```

### 共有リクエスト応答

```javascript
const respondToShareRequest = httpsCallable(functions, 'respondToShareRequest');

try {
  const result = await respondToShareRequest({
    requestId: 'request-id-here',
    status: 'accepted' // または 'rejected'
  });
  
  console.log('Result:', result.data);
} catch (error) {
  console.error('Error:', error);
}
```

## セキュリティ強化点

### 1. 入力値検証

すべての入力値が Joi スキーマで検証されます:

- **心拍数**: 30-250 bpm の範囲
- **パスワード**: 8-128文字、大文字・小文字・数字・特殊文字を含む
- **メールアドレス**: 有効な形式
- **名前**: 1-50文字、XSS対策

### 2. 認証・認可

- すべての Cloud Function が Firebase Authentication で保護
- ユーザーは自分のデータにのみアクセス可能
- 管理者権限の分離

### 3. レート制限

- 15分間に100リクエストまで
- IP アドレスとユーザーID で追跡

### 4. 監査ログ

- すべての重要な操作が記録
- IP アドレス、ユーザーエージェント、タイムスタンプを含む
- 改ざん防止のため不変

### 5. データ保護

- パスワードは bcrypt（salt rounds: 12）でハッシュ化
- 心拍データは不変（更新・削除不可）
- セキュリティ設定はクライアントから更新不可

## Firestore セキュリティルール

`functions/firestore.rules` で定義:

- **users**: 本人のみ読み取り・更新
- **heartRates**: 本人のみ読み取り、作成は userId 一致確認
- **security**: 本人のみ読み取り、更新・削除禁止
- **security_logs**: 本人のみ読み取り、作成・更新・削除禁止

## 監視とアラート

### 異常検出

- 短時間に複数のアカウント作成（1時間に10以上）
- 異常な心拍数（40未満または150超）
- 不正な入力試行

### 定期的なメンテナンス

- 24時間ごとにセキュリティ監査
- 1週間以上前のレート制限データ削除
- 30日以上前の未処理共有リクエスト削除

## 本番環境へのデプロイ

### 1. 環境変数の設定

```bash
firebase functions:secrets:set API_KEY
```

### 2. 本番環境デプロイ

```bash
firebase deploy --only functions,firestore,hosting
```

### 3. デプロイ後の確認

```bash
firebase functions:log
```

## トラブルシューティング

### 関数がデプロイされない

```bash
# 依存関係を確認
cd functions
npm install

# 再度デプロイ
firebase deploy --only functions
```

### Firestore ルールが適用されない

```bash
# ルールを再デプロイ
firebase deploy --only firestore:rules
```

### インデックスが不足している

```bash
# インデックスを再デプロイ
firebase deploy --only firestore:indexes
```

## 今後の改善点

1. **プッシュ通知**: 心拍異常時の即時通知
2. **エクスポート機能**: データの CSV/JSON エクスポート
3. **バックアップ**: 定期的なデータバックアップ
4. **分析**: 心拍数パターンの機械学習分析
5. **多言語対応**: 国際化（i18n）

## サポート

問題や質問がある場合は:

- GitHub Issues: [HealthShare Issues](https://github.com/Yuk1-11/yuki_py_1/issues)
- セキュリティレポート: security@healthshare.example.com