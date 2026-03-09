<div align="center">

# ❤️ HealthShare

### Apple Watch Heart Rate Sharing Platform

Apple Watchの心拍数をリアルタイムで共有できるサービス

<br>

![Swift](https://img.shields.io/badge/Swift-iOS-orange)
![Firebase](https://img.shields.io/badge/Firebase-Backend-yellow)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## 📖 Overview

HealthShareはApple Watchから取得した心拍数をクラウドに送信し、
家族・恋人・介護者などとリアルタイムで共有できるシステムです。

主な利用シーン

* 👴 高齢者見守り
* ❤️ カップル共有
* 👨‍👩‍👧 家族健康管理

---

## 🏗 System Architecture

```
Apple Watch
     ↓
iPhone App
     ↓
Firebase
     ↓
Web Dashboard
     ↓
Marketing Site
```

---

## 🚀 Features

* ⌚ Apple Watch 心拍取得
* ☁️ Firebase リアルタイム共有
* 📊 Webダッシュボード表示
* 🔐 Firebase Authentication
* 🚨 心拍異常通知（予定）

---

## 📂 Project Structure

```
HealthShare/
├── WatchApp/           AppleWatchアプリ
├── iPhoneApp/          iPhoneアプリ
├── Web/
│   ├── marketing-site  公式サイト
│   └── dashboard       心拍ダッシュボード
├── Docs/               設計書
├── firestore.json
├── firestore.lules     
└── README.md
```

---

## ⚙️ Tech Stack

| 技術              | 用途                     |
| --------------- | ---------------------- |
| Swift           | iPhone / AppleWatchアプリ |
| HealthKit       | 心拍取得                   |
| Firebase        | Backend                |
| Firestore       | データ保存                  |
| Firebase Auth   | ユーザー認証                 |
| HTML / CSS / JS | Web                    |

---

## 🧑‍💻 Development Setup

### リポジトリ取得

```
git clone https://github.com/Yuk1-11/HealthShare.git
cd HealthShare
```

### Firebase CLI

```
npm install -g firebase-tools
firebase login
```

### ローカル起動

```
firebase serve
```

---

## 📊 Roadmap

* Apple Watch 心拍送信
* Webリアルタイムグラフ
* 心拍異常通知
* 家族共有機能
* クラウドファンディング

---

## 🤝 Contributing

プロジェクトへの参加を歓迎します。

1. Fork
2. Branch作成
3. Commit
4. Pull Request

---

## 📜 License

MIT License

---

<div align="center">

Made with ❤️ for Health Monitoring

</div>
