# Database Design - HealthShare

## 概要

このドキュメントでは HealthShare の Firebase Firestore データベース設計をまとめます。  
目的は **Apple Watch → iPhone → Firebase → Web ダッシュボード** のデータフローを安全かつ効率的に管理することです。

---

## コレクション一覧

| コレクション | ドキュメントID | 説明 |
|-------------|----------------|------|
| users       | userId         | ユーザー情報 |
| heartRates  | auto-id        | 心拍数データ |
| sharing     | auto-id        | データ共有設定 |
| devices     | deviceId       | Apple Watch / iPhone デバイス情報 |

---

## 1. users コレクション

| フィールド | 型 | 説明 |
|-----------|----|------|
| name      | string | ユーザー名 |
| email     | string | メールアドレス（認証用） |
| createdAt | timestamp | アカウント作成日時 |

**ルール例**

```javascript
match /users/{userId} {
  allow read, write: if request.auth.uid == userId;
}
```

## 2.heartRates コレクション

| フィールド | 型 | 説明 |
|-----------|----|------|
| userId    | string | 所有ユーザーID |
| bpm       | number | 心拍数 |
| timestamp | timestamp | 取得日時 |
| deviceId  | string | デバイスID |

注意点

- 1秒〜数秒ごとにデータが送られる可能性があるので、Firestore の課金や容量に注意
- Webダッシュボードでは userId に基づきリアルタイム表示

ルール例
```
match /heartRates/{docId} {
  allow create: if request.auth.uid == resource.data.userId;
  allow read: if request.auth.uid == resource.data.userId
                || exists(/databases/$(database)/documents/sharing/$(request.auth.uid + "_" + resource.data.userId));
}
```

## 3.sharing コレクション

| フィールド | 型        | 説明             |
| --------- | --------- | --------------- |
| ownerId   | string    | データを提供するユーザーID  |
| viewerId  | string    | データを閲覧できるユーザーID |
| createdAt | timestamp | 共有開始日時          |

ルール例
```
match /sharing/{docId} {
  allow read, write: if request.auth.uid == resource.data.ownerId || request.auth.uid == resource.data.viewerId;
}
```

## 4.device コレクション

| フィールド    | 型        | 説明                      |
| ------------ | --------- | ------------------------- |
| deviceId     | string    | デバイス固有ID             |
| userId       | string    | 所有ユーザーID             |
| type         | string    | 'AppleWatch' または 'iPhone' |
| registeredAt | timestamp | 登録日時                   |

ルール例
```
match /devices/{deviceId} {
  allow read, write: if request.auth.uid == resource.data.userId;
}
```

---
## データフロー例
```
Apple Watch
    ↓ (HealthKit)
iPhone App
    ↓ (Firebase SDK)
Firestore heartRates
    ↓ (リアルタイムリスナー)
Web Dashboard
```
 - ユーザーは自分の心拍だけ見れる
 - 共有設定がある場合、他ユーザーも閲覧可能

 ---
## 注意点

## 1.個人情報保護

 - 心拍データはセンシティブ情報なので、必ず Security Rules を設定

## 2.課金対策

 - 高頻度でデータ送信される場合は batchWrite やデータ間引きも検討

## 3.将来拡張

 - 通知（異常値アラート）
 - 家族やカップルでの共有
 - 履歴表示（週/月単位）
