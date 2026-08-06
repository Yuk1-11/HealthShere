<div align="center">

# ❤️ HealthShare

### Apple Watch / iPhone / Web Heart Rate Sharing Platform

Apple Watchの心拍数をiPhone経由でFirebaseに送信し、Webダッシュボードで共有するためのプロトタイプ

<br>

![Swift](https://img.shields.io/badge/Swift-iOS-orange)
![Firebase](https://img.shields.io/badge/Firebase-Backend-yellow)
![Vite](https://img.shields.io/badge/Vite-Frontend-blue)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## 📖 Overview

HealthShareは、Apple Watchの心拍データをiPhoneで受信してFirebaseに保存し、Webブラウザでリアルタイムに確認できる健康管理プラットフォームです。

現在のリポジトリには、Webダッシュボード、認証、プロフィール管理、Firebase接続、およびSwiftUIアプリの土台が含まれています。

主な利用シーン

* 👴 高齢者の見守り
* ❤️ パートナーとの心拍共有
* 👨‍👩‍👧 家族の健康管理

---

## 🏗 Current Architecture

```
Apple Watch (planned)
     ↓
iPhone App (SwiftUI placeholder)
     ↓
Firebase Auth / Firestore
     ↓
Web Dashboard (HTML/CSS/JS)
```

---

## 🚀 Implemented Features

* 🔐 Firebase Authentication（Web）
* 📊 Webダッシュボードのリアルタイム表示
* 🧑‍💻 ユーザープロフィール管理
* 📁 Firebase Firestoreへのデータ読み取り
* ☁️ ViteベースのWeb開発環境
* 📄 セキュリティ設計ドキュメント多数

---

## 📂 Repository Structure

```
HealthShere/
├── app.js
├── dashboard.html
├── dashboard.js
├── firebase.js
├── index.html
├── style.css
├── two-factor.html
├── two-factor.js
├── security-advanced.js
├── tls13-kerberos.js
├── tls13-kerberos.test.js
├── firestore-design.md
├── meta.env
├── README.md
├── SECURITY_FEATURES.md
├── SERVER_SIDE_VALIDATION.md
├── package.json
├── package-lock.json
├── functions/
│   ├── firestore.indexes.json
│   ├── firestore.rules
│   └── index.js
├── HealthShere/
│   └── HealthShere/
│       ├── ContentView.swift
│       └── HealthShereApp.swift
└── vite-project/
    ├── index.html
    ├── package.json
    └── src/
```

---

## ⚙️ Tech Stack

| 技術            | 用途 |
| --------------- | ------------------------------------------------------------ |
| Swift / SwiftUI | iOS / WatchOSアプリのUIおよびビジネスロジック（現在は基礎構造） |
| Firebase        | 認証、Firestore、ホスティング、バックエンド連携 |
| Vite            | フロントエンド開発およびビルド |
| HTML / CSS / JS | Webダッシュボードと認証UI |

---

## 🧑‍💻 Development Setup

### 1. リポジトリを取得

```
git clone https://github.com/Yuk1-11/HealthShare.git
cd HealthShere
```

### 2. 依存パッケージをインストール

```
npm install
```

### 3. Firebase環境変数を設定

プロジェクトルートに`meta.env`または`.env`を用意し、以下を定義します。

```
VITE_FIREBASE_API_KEY=...
VITE_AUTH_DOMAIN=...
VITE_PROJECT_ID=...
VITE_STORAGE_BUCKET=...
VITE_MESSAGING_SENDER_ID=...
VITE_APP_ID=...
```

### 4. 開発用サーバーを起動

```
npm run dev
```

### 5. Firebase CLIを使う場合

```
npm install -g firebase-tools
firebase login
firebase serve
```

---

## 📝 TODO

現在の実装内容に基づき、詳細なTODOは`TODO.md`を参照してください。

---

## 📊 Roadmap

* 🍎 Apple Watchからの心拍データ送信実装
* 📱 iPhoneアプリとHealthKit / WatchConnectivity連携
* 📈 Webダッシュボードのリアルタイムグラフ強化
* 🚨 心拍異常検知と通知アラート
* 🔒 Firebaseセキュリティルールの検証
* 🧪 単体テストとE2Eテストの追加

---

## 🤝 Contributing

プロジェクトへの貢献を歓迎します。

1. Fork
2. 新しいブランチを作成
3. 変更を追加
4. Pull Requestを送信

GitHub IssueやPull Requestで`TODO.md`のタスクを参照してください。

---

## 📜 License

MIT License

---

<div align="center">

Made with ❤️ for Health Monitoring

</div>
