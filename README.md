<div align="center">

# ❤️ HealthShare

### Apple Watch / iPhone / Web Heart Rate Sharing Platform

Apple Watchで取得した心拍数をiPhone経由でFirebaseに保存し、
Webダッシュボードからリアルタイムで確認・共有できる健康管理プラットフォームです。

![Swift](https://img.shields.io/badge/Swift-iOS-orange)
![SwiftUI](https://img.shields.io/badge/SwiftUI-iOS-blue)
![Firebase](https://img.shields.io/badge/Firebase-Backend-yellow)
![Vite](https://img.shields.io/badge/Vite-Frontend-blue)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## 📖 Overview

**HealthShare**は、Apple Watchから取得した心拍データをiPhone経由でFirebaseへ送信し、Webブラウザからリアルタイムに確認・共有することを目指した健康管理プラットフォームです。

家族や介護者などが離れた場所から心拍数を確認できる仕組みを想定しています。

### 💡 主な利用シーン

* 👴 **高齢者の見守り**
* 👨‍👩‍👧 **家族の健康管理**
* ❤️ **大切な人との健康状態の共有**

---

## 🏗 System Architecture

```text
┌─────────────────┐
│   Apple Watch   │
│  心拍数を取得     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    iPhone App   │
│ Swift / SwiftUI │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│     Firebase    │
│ Auth/Firestore  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Web Dashboard  │
│ HTML / CSS / JS │
└─────────────────┘
```

### データの流れ

**Apple Watch → iPhone → Firebase → Web Dashboard**

---

## 🚀 Current Features

### 🌐 Web

* 🔐 Firebase Authenticationによるユーザー認証
* 📊 Webダッシュボード
* ⚡ Firebase / Firestoreとのデータ連携
* 🧑‍💻 ユーザープロフィール管理
* ☁️ Firebaseを利用したデータ保存

### 🔒 Security

* 🔐 Firebase Authentication
* 🛡️ Firestore Security Rules
* 📄 セキュリティ設計ドキュメント
* 🔑 サーバー側バリデーション設計

> Apple Watchからの心拍データ取得・送信機能は今後実装予定です。

---

## 📂 Project Structure

```text
HealthShare/
├── app.js
├── index.html
├── dashboard.html
├── dashboard.js
├── style.css
├── firebase.js
│
├── two-factor.html
├── two-factor.js
├── security-advanced.js
├── tls13-kerberos.js
├── tls13-kerberos.test.js
│
├── firestore-design.md
├── SECURITY_FEATURES.md
├── SERVER_SIDE_VALIDATION.md
├── README.md
│
├── package.json
├── package-lock.json
│
├── functions/
│   ├── firestore.indexes.json
│   ├── firestore.rules
│   └── index.js
│
├── HealthShare/
│   └── HealthShare/
│       ├── ContentView.swift
│       └── HealthShareApp.swift
│
└── vite-project/
    ├── index.html
    ├── package.json
    └── src/
```

---

## 🛠 Tech Stack

| 技術                          | 用途                      |
| --------------------------- | ----------------------- |
| **Swift / SwiftUI**         | iPhone / Apple Watchアプリ |
| **HealthKit**               | 心拍データの取得                |
| **Firebase Authentication** | ユーザー認証                  |
| **Firestore**               | 心拍データ・ユーザーデータの保存        |
| **Firebase**                | バックエンド・クラウド連携           |
| **Vite**                    | Webフロントエンド開発・ビルド        |
| **HTML / CSS / JavaScript** | Webダッシュボード              |

---

## ⚙️ Development Setup

### 1. リポジトリを取得

```bash
git clone https://github.com/Yuk1-11/HealthShare.git
cd HealthShare
```

### 2. 依存パッケージをインストール

```bash
npm install
```

### 3. Firebase環境変数を設定

プロジェクトルートに `.env` ファイルを作成し、Firebaseの設定を記述します。

```env
VITE_FIREBASE_API_KEY=...
VITE_AUTH_DOMAIN=...
VITE_PROJECT_ID=...
VITE_STORAGE_BUCKET=...
VITE_MESSAGING_SENDER_ID=...
VITE_APP_ID=...
```

> ⚠️ `.env` などの環境変数ファイルはGitHubへ公開しないでください。

### 4. Web開発サーバーを起動

```bash
npm run dev
```

### 5. Firebase CLIを使用する場合

```bash
npm install -g firebase-tools
firebase login
firebase serve
```

---

## 📊 Roadmap

今後、以下の機能の実装を予定しています。

* [ ] ⌚ Apple Watchから心拍データを取得
* [ ] 📱 iPhoneとApple Watchの連携
* [ ] ❤️ HealthKitとの連携
* [ ] 📡 WatchConnectivityによるデータ送信
* [ ] ☁️ Firebaseへの心拍データ自動送信
* [ ] 📈 Webダッシュボードのリアルタイムグラフ
* [ ] 🚨 心拍数の異常検知・通知
* [ ] 👨‍👩‍👧 家族共有機能
* [ ] 🔒 Firebase Security Rulesの強化
* [ ] 🧪 単体テスト・E2Eテストの追加

---

## 🤝 Contributing

HealthShareへの貢献を歓迎します。

1. **Fork**する
2. **Branch**を作成する
3. 変更を加える
4. **Commit**する
5. **Pull Request**を送信する

バグ報告や機能提案は、GitHub Issuesからお願いします。

---

## 📜 License

This project is licensed under the **MIT License**.

---

<div align="center">

### Made with ❤️ for Health Monitoring

</div>
