# HealthShere

## プロジェクト概要
**HealthShare** は Apple Watch の心拍データを iPhone で受信し、Firebase を介して PC/スマホダッシュボードに共有する健康管理アプリです。

目的：
- 高齢者見守り
- カップルや友人との心拍共有

対象：
- Apple Watch（WatchOS）
- iPhone（iOS）
- PC/スマホブラウザ（ダッシュボード）

---

## フォルダ構成

HealthShare/
---

## チーム分担

| 役割 | 担当作業 |
|------|-----------|
| Watch担当 | 心拍取得、WatchConnectivity送信 |
| iPhone担当 | データ受信、Firebase送信、UI表示 |
| Dashboard担当 | PC/スマホでグラフ・テーブル表示 |
| UI/UX担当 | デザイン改善、ボタン・画面レイアウト |
| ダミーデータ担当 | テスト用データ作成・シナリオ |

---

## 作業フロー（Git）

1. `git clone` でリポジトリをローカルにコピー
2. 新しい作業は **feature/〇〇** ブランチで開始
3. 作業完了後は Pull Request を作成
4. レビュー後、main ブランチにマージ
5. 定期的に main を pull して最新状態を反映

---

## 環境構築

- **Mac + Xcode**（Apple Watch / iPhone 開発用）
- **Apple Developer アカウント**（公開用）
- **Firebase プロジェクト**（Realtime Database, Authentication, Cloud Messaging）

---

## ダミーデータ利用方法

Apple Watch がない場合でもテスト可能：
```swift
let simulatedHeartRates = [72, 85, 65, 90, 78]
for bpm in simulatedHeartRates {
    sendHeartRateToFirebase(bpm)
}
