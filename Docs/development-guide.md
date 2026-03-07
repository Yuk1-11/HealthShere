# Development Guide

このドキュメントは HealthShare の開発環境構築と開発フローを説明します。

---

# 1 開発環境

推奨環境

| ソフト | 用途 |
|------|------|
| Git | ソース管理 |
| GitHub | リポジトリ管理 |
| Node.js | Firebase CLI |
| Firebase | Backend |
| Xcode | iPhone / AppleWatch開発 |
| VSCode | Web開発 |

---

# 2 リポジトリ取得

GitHubからプロジェクトを取得します。

git clone https://github.com/USERNAME/HealthShare.git

cd HealthShare

---

# 3 Firebase環境構築

### 1 Firebase CLIインストール

npm install -g firebase-tools

確認

firebase --version

### 2 Firebaseログイン

firebase login

ブラウザが開きログインします。

### 3 プロジェクト接続

firebase use --add

HealthShareプロジェクトを選択します。

---

# 4 Web開発

Webサイトは

Web/marketing-site

で開発します。

### ローカルサーバー起動

firebase serve

ブラウザで確認

http://localhost:5000

---

# 5 Firebase設定

Firebase設定は

firebase-config.js


に保存します。

例

```javascript
export const firebaseConfig = {
 apiKey: "YOUR_API_KEY",
 authDomain: "PROJECT.firebaseapp.com",
 projectId: "PROJECT_ID",
};

 ---

# 6 デプロイ

Webサイトを公開する場合

firebase deploy

公開URL

https://PROJECT.web.app

 ---

# 7 開発フロー

基本的な作業手順

- 1 新しいブランチ作成
- 2 開発
- 3 commit
- 4 push
- 5 Pull Request

例

git checkout -b feature/login
git add .
git commit -m "Add login page"
git push origin feature/login

 ---

# 8 コーディングルール

基本ルール
- ファイル名は小文字
- 意味のある名前を付ける
- コメントを書く
- 不要なコードを残さない

 ---

# 9 Issue管理

新しいタスクはGitHub Issueで管理します。

例

#1 ログインページ作成
#2 心拍グラフ表示
#3 AppleWatchデータ送信

 ---

# 10 今後の開発予定

今後追加予定
- AppleWatch心拍数取得
- Firebaseリアルタイム更新
- 心拍異常通知
- 家族共有機能

---
