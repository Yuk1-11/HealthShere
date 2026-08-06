# TODO

このリポジトリの現在の実装に基づく優先タスクです。

## 高優先度

- [ ] Apple WatchからiPhone経由で心拍データを取得し、Firebaseに送信する機能を実装する
- [ ] Webダッシュボードの既存Firebase接続を利用し、リアルタイムに心拍データを表示する
- [ ] `functions/firestore.rules` を確認し、Firestoreセキュリティルールを強化する
- [ ] Firebase Authenticationのユーザー登録・ログインフローを安定化する

## 中優先度

- [ ] `dashboard.html` / `dashboard.js` のグラフ表示を改善し、時間範囲切り替えをスムーズにする
- [ ] 異常心拍値（低すぎる/高すぎる）を判定し、アラート表示を追加する
- [ ] SwiftUIアプリのUIを心拍管理画面に拡張する
- [ ] iPhoneアプリとHealthKit / WatchConnectivity連携の設計を作成する

## 低優先度

- [ ] `vite-project` の開発環境を本プロジェクトのドキュメントに統合する
- [ ] `SECURITY_FEATURES.md` / `SERVER_SIDE_VALIDATION.md` の内容をREADMEに要約して反映する
- [ ] GitHub IssueテンプレートやPull Requestテンプレートを追加する
- [ ] 単体テストおよびE2Eテストを追加する
