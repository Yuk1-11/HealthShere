# HealthShare Architecture

## 概要

HealthShareはApple Watchの心拍数をリアルタイムで共有できるサービスです。  
ユーザーの心拍データをクラウドに送信し、Webダッシュボードや他のユーザーが確認できるようにします。

---

# コンポーネント説明

## Apple Watch App

役割

- 心拍数を取得
- iPhoneへデータ送信

使用技術

- WatchKit
- HealthKit
- WatchConnectivity

取得データ

- heartRate
- timestamp
- deviceId


---

## iPhone App

役割

- Apple Watchからデータ受信
- Firebaseへ送信
- 通知管理

使用技術

- Swift
- HealthKit
- Firebase SDK


---

## Firebase (Backend)

役割

- ユーザー管理
- 心拍データ保存
- リアルタイム共有
- セキュリティ管理

使用サービス

- Firebase Authentication
- Firestore Database
- Firebase Hosting


---

## Web Dashboard

役割

- 複数ユーザーの心拍を表示
- グラフ表示
- リアルタイム更新

使用技術

- HTML
- CSS
- JavaScript
- Chart.js
- Firebase SDK


---

## Marketing Site

役割

- サービス紹介
- アカウント作成
- お問い合わせ

使用技術

- HTML
- CSS
- JavaScript
- Firebase Authentication
- Firebase Hosting


---

# セキュリティ設計

- Firebase Authenticationでユーザー認証
- Firestore Security Rulesでアクセス制御


---

# 将来拡張

- 心拍異常通知
- Apple Watchグラフ表示
- 家族共有
- 高齢者見守り機能
- クラウドファンディング対応

