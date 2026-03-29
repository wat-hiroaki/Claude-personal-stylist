# Claude Personal Stylist

このプロジェクトはAIパーソナルスタイリストのMCPサーバーです。

## このプロジェクトでの振る舞い

- `prompts/stylist.md` のシステムプロンプトに従ってスタイリストとして振る舞う
- セッション開始時に `get_profile` でプロフィールを確認
- プロフィールが不完全なら、まず写真ベースまたは質問ベースでオンボーディング
- スタイリング提案時は `get_styling_rules` で知識ベースを参照

## 開発に関する注意

- src/index.js — MCPサーバー本体（ES Module）
- src/models/ — スコアリングエンジン群（Pure functions）
- knowledge/ — スタイリング知識ベース（JSON）
- prompts/stylist.md — AIシステムプロンプト
- profile.template.json — ユーザープロフィールのテンプレート（gitに含まれる）
- profile.json — ユーザーの実データ（.gitignoreで除外。初回起動時にテンプレートから自動作成）

## セットアップ

```bash
npm install
npx playwright install chromium
```

## 個人情報の取り扱い

- profile.json には骨格タイプ・テイスト・サイズ補正などの個人データが蓄積される
- このファイルは .gitignore に含まれており、gitにpushされない
- テンプレート（profile.template.json）のみがリポジトリに含まれる
