# Discord Reminder Bot 🕊

通学、天気、タスク、ニュースを自動でDM通知する Discord Bot です。

## 📦 主な機能

- ✅ 毎朝6時：天気・時間割・NotionタスクをDMで通知
- 📰 毎日3回（朝昼夜）：ジャンル別ニュース通知（英語記事は自動翻訳）
- 📝 タスク追加：モーダル＋選択式でNotionに登録
- 🚆 通学案内：GO / BACK ボタンでルート表示

## ⚙️ セットアップ手順

```bash
git clone https://github.com/あなたのユーザー名/haifuyou-DRB.git
cd discord-reminder-bot
npm install
cp .env.example .env  # 自分のAPIキーを.envに入力
npm start

## 🧪 ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。  
自由に利用・改変・再配布可能ですが、元の著作権表記は残してください。
