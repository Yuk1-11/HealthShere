# API Specification - HealthShare

このドキュメントは HealthShare のデータ送受信ルールをまとめたものです。  
Firebase SDK を使った操作を **API 呼び出しとして表現**しています。

---

## 1️.ユーザー管理 (users)

### アカウント作成

| メソッド | パス | リクエスト | 説明 |
|-----------|------|------------|------|
| POST | /users | `{ name, email }` | Firebase Auth でアカウント作成 |

**Firestore に保存するフィールド例**

```json
{
  "name": "Taro Yamada",
  "email": "taro@example.com",
  "createdAt": "2026-03-07T12:00:00Z"
}
```

### ユーザー情報取得

| メソッド | パス         | 説明                 |
| ---- | --------------- | -------------------- |
| GET  | /users/{userId} | Firestore からユーザー情報取得 |

 - ルール: 本人のみ閲覧可能

## 2.心拍データ (heartRates)

### 心拍データ送信

| メソッド | パス     | リクエスト                              | 説明                            |
| ---- | ----------- | -------------------------------------- | ------------------------------- |
| POST | /heartRates | `{ userId, bpm, timestamp, deviceId }` | Apple Watch → iPhone → Firebase |

 - Firestore の heartRates コレクションに保存
 - Security Rules で本人または共有相手のみ閲覧可能

### 心拍データ取得

| メソッド | パス                | 説明              |
| ---- | ---------------------- | ----------------- |
| GET  | /heartRates?userId=xxx | Web ダッシュボード用データ取得 |

 - SDK では リアルタイムリスナー を使用
 - フィルター: 最新 N 件 / 時間範囲指定など可能

## 3.データ共有 (sharing)

### 共有設定作成

| メソッド | パス  | リクエスト               | 説明            |
| ---- | -------- | ----------------------- | --------------- |
| POST | /sharing | `{ ownerId, viewerId }` | 心拍データを特定ユーザーに共有 |

### 共有ユーザー取得

| メソッド | パス                  | 説明                    |
| ---- | ------------------------ | ----------------------- |
| GET  | /sharing?viewerId=xyz789 | viewerId が閲覧可能なユーザー一覧取得 |

 - Firestore の sharing コレクションを参照
 - Security Rules で所有者または閲覧者のみアクセス可能

## 4.デバイス管理 (devices)

### デバイス登録

| メソッド | パス  | リクエスト                    | 説明                    |
| ---- | -------- | ---------------------------- | ----------------------- |
| POST | /devices | `{ deviceId, userId, type }` | Apple Watch / iPhone 登録 |

 - Security Rules で本人のみ読み書き可能

### デバイス情報取得

| メソッド | パス                | 説明       |
| ---- | ---------------------- | ---------- |
| GET  | /devices?userId=abc123 | 所有デバイス情報取得 |

## 5.備考・運用ルール

 - すべてのリクエストは Firebase Authentication で認証済み
 - heartRates は本人または sharing で許可された相手のみ読み取り可能
 - データ送信頻度が高い場合は Firestore の課金・容量に注意
 - SDK で操作する場合も「API Spec に沿ってデータ構造を統一」
