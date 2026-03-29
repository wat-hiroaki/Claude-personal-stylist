# 👔 Claude-Personal-Stylist

**[🇬🇧 English](#-english)** | **[🇯🇵 日本語](#-日本語)**

---

# 🇬🇧 English

## Find what suits YOU from your favorite brands — AI Personal Stylist

> **For people who love fashion but lack confidence in their taste, and are too lazy to research.**
> This AI stylist combines X (Twitter) trends, your body type, personal color analysis,
> and favorite brand aesthetics to tell you exactly what to buy.
>
> **Works with any fashion site.** UNIQLO, ZARA, SSENSE, ZOZOTOWN,
> Jil Sander, Lemaire… just add a URL.

### ✨ Features

- 🛒 **Shop recommendations from any brand** — just add URLs to your profile
- 📐 **Body type & personal color analysis** — size & color suggestions tailored to your physique
- 🎯 **Taste profiling (5-axis)** — quantifies your style preferences across minimalist-decorative, casual-dressy, classic-mode, relaxed-structured, sophisticated-playful
- 👗 **Outfit coordination scoring** — evaluates color harmony, silhouette balance, TPO compliance, and seasonal fit of combinations
- 🖼️ **Visual product analysis** — Claude sees actual product images to judge silhouette, texture, and color tone
- 🔥 **X (Twitter) trend tracking** — finds viral items and must-buys
- 🔗 **Direct product links** — click and buy

### 🚀 Setup (15 min)

#### Prerequisites

| Requirement | Notes |
|---|---|
| **Claude Pro** ($20/mo) | Sign up at [claude.ai](https://claude.ai) |
| **Claude Desktop app** | [Download](https://claude.ai/download) |
| **Node.js** (v18+) | [Download](https://nodejs.org/) |
| **Git** | [Download](https://git-scm.com/) |

#### Step 1: Clone this repo

```bash
git clone https://github.com/wat-hiroaki/Claude-personal-stylist.git
cd claude-personal-stylist
npm install
npm run setup   # Installs Playwright browser
```

#### Step 1.5: Set up X API key (optional)

For fetching trending fashion items directly from X (Twitter) with engagement data.
**Works without it** — falls back to Google search for X posts automatically.

> ⚠️ As of 2026, X API uses **pay-per-use** pricing. No subscriptions.
> You buy credits upfront, charged per request. Light usage costs ~$5–25/month.

1. Visit [X Developer Portal](https://developer.x.com/en/portal/dashboard)
2. Sign up → Create an App
3. Purchase credits in the Developer Console
4. Get your **Bearer Token**
5. Copy the env template and paste your token:

```bash
cp .env.example .env
# Edit .env and paste your token after X_BEARER_TOKEN=
```

> 💡 With X API: engagement-sorted results (likes, RTs). Without: Google-sourced X posts.

#### Step 2: Set up your profile

Your profile is created automatically on first run from the template.
You can edit `profile.json` with your info, or let the AI ask you during the first conversation.

```bash
# Optional: pre-fill your profile before starting
cp profile.template.json profile.json
# Edit profile.json with your info
```

> 💡 **Don't know your body type?** → Just start chatting. The AI will diagnose you via photos or questions.

#### Step 3: Connect to Claude (project-scoped — won't affect your other work)

The MCP config lives **inside this repo**, so it only activates when you open Claude in this directory. Your coding sessions, other projects, and Claude Desktop are not affected.

This is already set up for you. Just run Claude Code from the repo:

```bash
cd claude-personal-stylist
claude
```

That's it. The `.claude/settings.json` in this repo tells Claude where the stylist server is.

> 💡 **How it works:** Claude Code reads `.claude/settings.json` in the current directory.
> The stylist tools only appear when you're inside this project folder.
> Navigate away and they're gone — zero interference with your other work.

<details>
<summary>🔧 Alternative: Claude Desktop (global config)</summary>

If you prefer Claude Desktop over Claude Code, add to your global config:

- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "claude-personal-stylist": {
      "command": "node",
      "args": ["<FULL_PATH>/claude-personal-stylist/src/index.js"],
      "env": {}
    }
  }
}
```

> ⚠️ This adds stylist tools to **all** Claude Desktop conversations.
> To limit this, rename the key to `_claude-personal-stylist` when not in use.

</details>

#### Step 4: Start chatting

```bash
claude  # from the repo directory
```

Say hi, and the stylist will guide you through setup.

### 🗣️ Usage

#### First time? Send a photo for instant diagnosis

The AI can analyze your body type and personal color from a single full-body photo.
Just send a photo in Claude Desktop — no questionnaires needed.

> 📸 **Photo tips:** Wear simple clothes (T-shirt + pants), stand naturally, full body visible, good lighting.
>
> No photo? No problem — the AI will ask 3-5 simple questions instead.

#### Then just ask:

```
What should I buy from UNIQLO right now?
```
```
Style me like Jil Sander using ZARA pieces
```
```
What's trending on X for menswear this week?
```
```
Build me a full outfit for a date. Budget $100. Use UNIQLO + ZARA.
```

### 🔧 Customization

**Change taste** → Edit `taste.target_vibes` in `profile.json`

**Add stores** → Add any fashion site URL to `shopping.stores`:

```json
"stores": [
  { "name": "SSENSE", "urls": ["https://www.ssense.com/en-us/men/sale"] },
  { "name": "Mr Porter", "urls": ["https://www.mrporter.com/en-us/mens/clothing"] },
  { "name": "COS", "urls": ["https://www.cos.com/en/men/new-arrivals.html"] }
]
```

### ❓ FAQ

**Q: Do I need coding skills?** → No. Copy-paste Steps 1–4 and edit `profile.json`.

**Q: Is it free?** → You need Claude Pro ($20/mo). Everything else is free.

**Q: Where is my data stored?** → Everything local. Data is sent to Anthropic only during API calls, per their [privacy policy](https://www.anthropic.com/policies).

---

# 🇯🇵 日本語

## 好きなブランドで「似合う」を見つけるAIスタイリスト

> **ファッション好きだけどセンスに自信ない、調べるのめんどい人**のためのAIスタイリスト。
> Xのトレンド・あなたの骨格タイプ・好きなブランドのテイストを全部混ぜて、
> 「今これ買え」を教えてくれます。
>
> **どんなファッションサイトにも対応。** UNIQLO、ZARA、SSENSE、ZOZOTOWN、
> Jil Sander、Lemaire… URLを追加するだけ。

### ✨ できること

- 🛒 **好きなブランド・ショップの今買うべきアイテム**を提案（URLを追加するだけで任意のサイトに対応）
- 📐 **骨格診断・パーソナルカラー**に基づいたサイズ＆色提案
- 🎯 **テイスト診断（5軸）** — 好みを「ミニマル↔デコラティブ」「カジュアル↔ドレッシー」等5軸で定量化
- 👗 **コーデ組み合わせ評価** — 配色・シルエット・TPO・季節適合を8軸で自動採点
- 🖼️ **商品画像の視覚分析** — 実際の商品画像を見てシルエット・素材感・色味を判断
- 🔥 **Xのトレンド**（「神パンツ」「名品ニット」等）を自動チェック
- 🔗 商品ページのリンク付きで提案 → そのまま買える

### 🚀 セットアップ（15分で終わります）

#### 必要なもの

| 必要なもの | 備考 |
|---|---|
| **Claude Pro** ($20/月) | [claude.ai](https://claude.ai) で登録 |
| **Claude Desktop アプリ** | [ダウンロード](https://claude.ai/download) |
| **Node.js** (v18以上) | [ダウンロード](https://nodejs.org/) |
| **Git** | [ダウンロード](https://git-scm.com/) |

#### Step 1: このリポジトリをダウンロード

```bash
git clone https://github.com/wat-hiroaki/Claude-personal-stylist.git
cd claude-personal-stylist
npm install
npm run setup   # Playwrightのブラウザをインストール
```

#### Step 1.5: X APIキーを設定（オプション）

Xのトレンド情報を**X API経由**で取得したい場合に設定します。
未設定でもGoogle検索経由で自動的にXの投稿を拾うので、**なくても動きます。**

> ⚠️ 2026年現在、X APIは**従量課金（pay-per-use）**です。月額制ではありません。
> クレジットを事前購入し、使った分だけ消費。少量なら月$5〜25程度。

1. [X Developer Portal](https://developer.x.com/en/portal/dashboard) にアクセス
2. アカウント登録 → Appを作成
3. Developer Console でクレジットを購入
4. **Bearer Token** を取得
5. `.env.example` をコピーして `.env` を作成：

```bash
cp .env.example .env
```

6. `.env` を開いて `X_BEARER_TOKEN=` の後にトークンを貼り付け

> 💡 X APIを設定するとエンゲージメント（いいね・RT数）順のソートが可能になります。
> 設定しない場合はGoogle検索で `site:x.com` を使って代替します。

#### Step 2: 自分のプロフィールを設定

初回起動時に `profile.template.json` から `profile.json` が自動作成されます。
事前に編集してもOKだし、何も書かなくてもAIが会話で聞いてくれます。

```bash
# 任意: 事前にプロフィールを書いておく場合
cp profile.template.json profile.json
# profile.json を編集
```

> 💡 **骨格タイプが分からない？** → そのまま始めてOK。写真か質問で診断してくれます。
>
> ⚠️ `profile.json` は `.gitignore` に含まれており、gitにpushされません。個人情報は安全です。

#### Step 3: Claudeに接続（プロジェクトスコープ — 他の作業に影響しません）

MCP設定は**このリポジトリの中**にあるので、このディレクトリでClaudeを開いたときだけスタイリストが有効になります。
普段のコーディングやClaude Desktopには一切影響しません。

設定は最初から入っています。リポジトリ内でClaude Codeを起動するだけ：

```bash
cd claude-personal-stylist
claude
```

> 💡 **仕組み:** Claude Codeはカレントディレクトリの `.claude/settings.json` を読みます。
> このフォルダにいるときだけスタイリストツールが使えます。
> 別のフォルダに移動すればツールは消えます。

<details>
<summary>🔧 別の方法: Claude Desktop（グローバル設定）</summary>

Claude Desktopを使いたい場合はグローバル設定に追加：

- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "claude-personal-stylist": {
      "command": "node",
      "args": ["<フルパス>/claude-personal-stylist/src/index.js"],
      "env": {}
    }
  }
}
```

> ⚠️ この方法だと**全てのClaude会話**にスタイリストツールが表示されます。
> 使わないときはキー名を `_claude-personal-stylist` にリネームして無効化してください。

</details>

#### Step 4: 話しかける

```bash
claude  # リポジトリ内で実行
```

挨拶すると、スタイリストがセットアップを案内してくれます。

### 🗣️ 使い方

#### 初めての方は写真1枚で即診断

全身写真を送るだけで、AIが骨格タイプ・パーソナルカラーを分析します。
質問に答える必要はありません。

> 📸 **撮影のコツ:** シンプルな服装（Tシャツ+パンツ等）、自然に立つ、全身が映るように、明るい場所で。
>
> 写真が難しい場合は、3-5問の簡単な質問で診断します。

#### あとは話しかけるだけ：

```
ユニクロで今買うべきもの教えて
```
```
ジルサンダーっぽくユニクロで揃えたい
```
```
Xで今話題のユニクロアイテムある？
```
```
明日デートなんだけど、ユニクロ+ZARAで全身コーデ組んで。予算15,000円以内で。
```

### 🔧 カスタマイズ

**テイストを変えたい** → `profile.json` の `taste.target_vibes` を書き換え

**店を追加したい** → `shopping.stores` にURLを追加するだけ：

```json
"stores": [
  { "name": "UNIQLO", "urls": ["https://www.uniqlo.com/jp/ja/men/tops/t-shirts"] },
  { "name": "Jil Sander", "urls": ["https://www.jilsander.com/ja-jp/men/"] },
  { "name": "SSENSE", "urls": ["https://www.ssense.com/ja-jp/men/sale"] },
  { "name": "ZOZOTOWN", "urls": ["https://zozo.jp/men-category/tops/tshirt-cutsew/"] }
]
```

### ❓ よくある質問

**Q: プログラミング分からなくても使える？** → Step 1〜4をコピペで実行するだけ。

**Q: 無料で使える？** → Claude Pro（$20/月）が必要。それ以外は無料。

**Q: データはどこに保存される？** → すべてローカル。Anthropicの[利用規約](https://www.anthropic.com/policies)に基づきAPI通信時のみデータが送信されます。

---

## 📁 Project Structure

```
claude-personal-stylist/
├── README.md              ← You are here / いまここ
├── profile.json           ← Your profile / あなたの情報
├── src/
│   └── index.js           ← MCP server (universal scraper)
├── prompts/
│   └── stylist.md         ← AI system prompt (customizable)
├── package.json
├── .env.example           ← Environment variables template
└── .gitignore
```

## 🤝 Contributing

Issues & PRs welcome! / Issue・PR歓迎！

## 📝 License

MIT

## ⚠️ Disclaimer

- For personal use / 個人利用を想定
- Follow each site's ToS / 各サイトの利用規約に従ってください
- Product info may be inaccurate / 商品情報の正確性は保証できません
- AI opinions, not professional advice / AIの意見であり、プロの助言ではありません

---

**Made with 🤖 by [wat-hiroaki](https://github.com/wat-hiroaki)**
