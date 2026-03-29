#!/usr/bin/env node

/**
 * AI Stylist — MCP Server
 * 
 * Claude Desktop / Claude Code から呼び出されるMCPサーバー。
 * 汎用スクレイパーで任意のファッションサイトから商品情報を取得し、
 * ユーザープロフィールに基づいたスタイリング提案を支援する。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { scoreAndRankProducts } from "./models/style-scorer.js";
import { evaluateDiagnosis, estimateVectorFromBrands, findTopArchetypes } from "./models/taste-engine.js";
import { scoreOutfit } from "./models/coordination-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = path.join(__dirname, "..", "profile.json");

// ─── プロフィール読み込み ───────────────────────────────
function loadProfile() {
  try {
    const raw = fs.readFileSync(PROFILE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── ナレッジ一括読み込み ────────────────────────────────
function loadAllKnowledge() {
  const KNOWLEDGE_DIR = path.join(__dirname, "..", "knowledge");
  const files = {
    skeleton: "skeleton-types.json",
    color: "personal-colors.json",
    face: "face-types.json",
    body: "body-proportions.json",
    coordination: "coordination-rules.json",
    taste: "taste-axes.json",
  };
  const knowledge = {};
  for (const [key, filename] of Object.entries(files)) {
    try {
      knowledge[key] = JSON.parse(
        fs.readFileSync(path.join(KNOWLEDGE_DIR, filename), "utf-8")
      );
    } catch (err) {
      knowledge[key] = null;
    }
  }
  return knowledge;
}

// ─── 画像取得ヘルパー ─────────────────────────────────
/**
 * URLから画像を取得してbase64エンコードする
 * Playwrightのページコンテキストを使い、同一セッションのCookieを維持
 *
 * @param {import('playwright').Page} page - Playwrightページ
 * @param {string} imageUrl - 画像URL
 * @param {number} [maxSizeKB=500] - 最大サイズ（KB）。超過時はスキップ
 * @returns {Promise<{ data: string, mimeType: string } | null>}
 */
async function fetchImageAsBase64(page, imageUrl, maxSizeKB = 500) {
  try {
    const response = await page.context().request.get(imageUrl, { timeout: 10000 });
    if (!response.ok()) return null;

    const buffer = await response.body();
    if (buffer.length > maxSizeKB * 1024) return null;

    const contentType = response.headers()["content-type"] || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();

    // 画像MIMEタイプのみ
    if (!mimeType.startsWith("image/")) return null;

    return {
      data: buffer.toString("base64"),
      mimeType,
    };
  } catch {
    return null;
  }
}

// ─── 汎用スクレイパー ─────────────────────────────────
async function scrapeProducts(url, options = {}) {
  const { maxItems = 20, category = "", scrollCount = 3, inlineImageCount = 5 } = options;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // ページを数回スクロールして遅延読み込みを発火
    for (let i = 0; i < scrollCount; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(1500);
    }

    // ページ全体のテキスト＋リンク＋画像を構造化抽出
    const pageData = await page.evaluate((max) => {
      // 商品っぽい要素を探すヒューリスティクス
      const candidates = [];

      // 方法1: 価格を含む要素の親を商品カードとみなす
      const pricePatterns = [
        /¥[\d,]+/,
        /￥[\d,]+/,
        /[\d,]+円/,
        /\$[\d.]+/,
        /€[\d.]+/,
        /USD\s*[\d.]+/,
      ];

      const allElements = document.querySelectorAll("a, article, div, li");
      const seen = new Set();

      for (const el of allElements) {
        const text = el.innerText || "";
        if (text.length < 10 || text.length > 2000) continue;

        const hasPrice = pricePatterns.some((p) => p.test(text));
        if (!hasPrice) continue;

        // 重複排除（テキストの先頭100文字でデデュプ）
        const key = text.slice(0, 100).trim();
        if (seen.has(key)) continue;
        seen.add(key);

        // リンク取得
        const link =
          el.tagName === "A"
            ? el.href
            : el.querySelector("a")?.href || "";

        // 画像取得
        const img =
          el.querySelector("img")?.src ||
          el.querySelector("img")?.dataset?.src ||
          "";

        candidates.push({
          text: text.slice(0, 500),
          link,
          image: img,
        });

        if (candidates.length >= max) break;
      }

      return {
        title: document.title,
        url: window.location.href,
        candidates,
      };
    }, maxItems);

    // ページのメタ情報も取得
    const meta = await page.evaluate(() => ({
      description:
        document.querySelector('meta[name="description"]')?.content || "",
      ogTitle:
        document.querySelector('meta[property="og:title"]')?.content || "",
    }));

    // 先頭N件の商品画像をbase64で取得（Claudeが視覚的に判断できるよう）
    const inlineImages = [];
    for (let i = 0; i < Math.min(inlineImageCount, pageData.candidates.length); i++) {
      const imgUrl = pageData.candidates[i].image;
      if (!imgUrl) continue;
      const img = await fetchImageAsBase64(page, imgUrl, 300);
      if (img) {
        inlineImages.push({ index: i, productText: pageData.candidates[i].text.slice(0, 80), ...img });
      }
    }

    await browser.close();

    return {
      success: true,
      site: {
        title: pageData.title,
        url: pageData.url,
        description: meta.description,
      },
      rawProducts: pageData.candidates,
      count: pageData.candidates.length,
      inlineImages,
      instruction: `
以下は ${pageData.url} から取得した商品候補の生データです。
各候補の text フィールドには商品名・価格・説明が混在しています。

【重要】先頭${inlineImages.length}件の商品画像が添付されています。
スタイリストとして各画像を観察し、テキスト情報と合わせて総合的に判断してください。
画像から読み取れるシルエット・素材感・色味・ディテールは、テキストだけでは得られない重要な判断材料です。

ユーザーのプロフィール（骨格タイプ、パーソナルカラー、テイスト等）と
照らし合わせて、似合うアイテムを選んでください。
`,
    };
  } catch (err) {
    await browser.close();
    return {
      success: false,
      error: err.message,
      url,
    };
  }
}

// ─── 商品詳細ページのスクレイピング ─────────────────────
async function scrapeProductDetail(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const getText = (sel) =>
        document.querySelector(sel)?.innerText?.trim() || "";

      // 構造化データ（JSON-LD）があれば最優先で使う
      const jsonLd = document.querySelector(
        'script[type="application/ld+json"]'
      );
      let structured = null;
      if (jsonLd) {
        try {
          const parsed = JSON.parse(jsonLd.textContent);
          // Product型を探す
          const product = Array.isArray(parsed)
            ? parsed.find((p) => p["@type"] === "Product")
            : parsed["@type"] === "Product"
            ? parsed
            : null;
          if (product) {
            structured = {
              name: product.name,
              price: product.offers?.price || product.offers?.[0]?.price,
              currency:
                product.offers?.priceCurrency ||
                product.offers?.[0]?.priceCurrency,
              description: product.description,
              image: product.image,
              brand: product.brand?.name,
              sku: product.sku,
              availability: product.offers?.availability,
            };
          }
        } catch {}
      }

      // ページ本文からも情報取得
      const body = document.body.innerText.slice(0, 3000);
      const images = Array.from(document.querySelectorAll("img"))
        .map((img) => img.src || img.dataset?.src)
        .filter((src) => src && src.startsWith("http"))
        .slice(0, 10);

      return {
        title: document.title,
        url: window.location.href,
        structured,
        bodyText: body,
        images,
      };
    });

    // 商品画像をbase64で取得（最大3枚）
    const imageResults = [];
    const targetImages = (data.images ?? []).slice(0, 3);
    for (const imgUrl of targetImages) {
      const img = await fetchImageAsBase64(page, imgUrl);
      if (img) {
        imageResults.push(img);
      }
    }

    await browser.close();

    return {
      success: true,
      ...data,
      imageCount: imageResults.length,
      images_base64: imageResults,
      instruction: `
以下は商品詳細ページの情報です。
structured フィールドにJSON-LDから抽出した構造化データがあります（ある場合）。
bodyText にはページ本文のテキストが含まれています。

【重要】画像が添付されています。スタイリストとして画像を注意深く観察し、以下を判断してください：
- 実際のシルエット（身幅、着丈のバランス、肩の落ち方）
- 生地の質感・落ち感（光沢、マット、透け感、厚み）
- 色のトーン（テキストでは「ブラック」でも実際は墨黒、漆黒、チャコールなど異なる）
- ディテール（縫製、ボタン、ステッチ、裏地の見え方）
- 全体の雰囲気（ミニマル/デコラティブ、モード/クラシック、リラックス/構築的）

テキスト情報と画像の両方を総合して、ユーザーの体型情報と照合のうえ推奨サイズ・カラーを提案してください。
`,
    };
  } catch (err) {
    await browser.close();
    return { success: false, error: err.message, url };
  }
}

// ─── X（Twitter）API v2 検索 ─────────────────────────────
async function searchX(query, maxResults = 10) {
  const bearerToken = process.env.X_BEARER_TOKEN;

  if (!bearerToken) {
    // X APIなし → Google検索で site:x.com のフォールバックを自動実行
    const fallback = await searchTrendsX(query);
    return {
      ...fallback,
      note: "X APIが未設定のため、Google検索経由でXの投稿を取得しました。X APIを設定するとエンゲージメント（いいね・RT数）付きの正確な結果が得られます。",
      setup: `
X APIの設定方法（オプション）:
1. https://developer.x.com/en/portal/dashboard にアクセス
2. アカウント登録 → App を作成
3. Developer Console でクレジットを購入（従量課金: 約$0.005/ツイート読み取り）
4. Bearer Token を取得
5. .env ファイルに X_BEARER_TOKEN=your_token を追加
6. Claude Desktop を再起動

※ 月額制ではなく従量課金です。少量なら月$5〜25程度。
`,
    };
  }

  try {
    const url = new URL("https://api.x.com/2/tweets/search/recent");
    url.searchParams.set("query", `${query} -is:retweet lang:ja`);
    url.searchParams.set("max_results", String(Math.min(maxResults, 100)));
    url.searchParams.set(
      "tweet.fields",
      "created_at,public_metrics,author_id,text"
    );
    url.searchParams.set("sort_order", "relevancy");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      return {
        success: false,
        error: `X API error ${res.status}: ${errBody}`,
        hint:
          res.status === 401
            ? "Bearer Tokenが無効です。developer.x.com で確認してください。"
            : res.status === 429
            ? "レート制限に達しました。しばらく待ってから再試行してください。"
            : "X APIでエラーが発生しました。",
      };
    }

    const data = await res.json();
    const tweets = (data.data || []).map((t) => ({
      text: t.text,
      created_at: t.created_at,
      likes: t.public_metrics?.like_count || 0,
      retweets: t.public_metrics?.retweet_count || 0,
      replies: t.public_metrics?.reply_count || 0,
      url: `https://x.com/i/status/${t.id}`,
    }));

    // エンゲージメント順にソート
    tweets.sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets));

    return {
      success: true,
      query,
      tweets,
      count: tweets.length,
      instruction: `
以下はX（旧Twitter）API v2 で「${query}」を検索した結果です。
エンゲージメント（いいね・RT）順にソート済み。

ファッションに関連するトレンドや話題のアイテムを抽出してください。
特に以下に注目：
- 「神○○」「名品」「買うべき」等のバズワード
- 具体的な商品名やブランド名の言及
- サイズ感に関するリアルな口コミ
- スタイリングの参考になる着こなし情報
- いいね数が多い投稿は特に注目
`,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

// ─── Google経由のX投稿検索（X API未設定時のフォールバック） ──
async function searchTrendsX(query) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
  });
  const page = await context.newPage();

  try {
    // site:x.com でXの投稿をGoogle経由で検索
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
      `site:x.com ${query}`
    )}&tbs=qdr:m`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const results = await page.evaluate(() => {
      const items = [];
      const searchResults = document.querySelectorAll(".g, .tF2Cxc");

      for (const result of searchResults) {
        const title = result.querySelector("h3")?.innerText || "";
        const snippet = result.querySelector(".VwiC3b")?.innerText || "";
        const link = result.querySelector("a")?.href || "";

        if (title) {
          items.push({ title, snippet, link });
        }
      }

      return items.slice(0, 10);
    });

    await browser.close();

    return {
      success: true,
      source: "google_site_x",
      query,
      results,
      count: results.length,
      instruction: `
以下はGoogle検索で site:x.com を使って「${query}」に関するX投稿を取得した結果です。
タイトルとスニペットからファッショントレンド情報を抽出してください。

特に以下に注目：
- 「神○○」「名品」「買うべき」等のバズワード
- 具体的な商品名やブランド名の言及
- サイズ感に関するリアルな口コミ
`,
    };
  } catch (err) {
    await browser.close();
    return { success: false, error: err.message };
  }
}

// ─── Google経由の一般トレンド検索（ブログ・メディア記事） ──
async function searchTrends(query) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
  });
  const page = await context.newPage();

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
      query
    )}&tbs=qdr:m`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const results = await page.evaluate(() => {
      const items = [];
      const searchResults = document.querySelectorAll(".g, .tF2Cxc");

      for (const result of searchResults) {
        const title = result.querySelector("h3")?.innerText || "";
        const snippet = result.querySelector(".VwiC3b")?.innerText || "";
        const link = result.querySelector("a")?.href || "";

        if (title) {
          items.push({ title, snippet, link });
        }
      }

      return items.slice(0, 10);
    });

    await browser.close();

    return {
      success: true,
      source: "google_general",
      query,
      results,
      count: results.length,
    };
  } catch (err) {
    await browser.close();
    return { success: false, error: err.message };
  }
}

// ─── 骨格診断 ─────────────────────────────────────────

/**
 * 骨格診断の15問リスト。
 * 各選択肢は { label, scores } 形式で、加算するタイプスコアを保持する。
 */
const SKELETON_QUESTIONS = [
  {
    id: 1,
    question: "手首を反対の手で掴んだとき、指と指の関係は？",
    options: [
      { label: "余る（隙間ができる）", scores: { wave: 1 } },
      { label: "ぴったり重なる", scores: { straight: 1 } },
      { label: "骨が当たって痛い", scores: { natural: 1 } },
    ],
  },
  {
    id: 2,
    question: "肩の特徴は？",
    options: [
      { label: "薄くなで肩ぎみ", scores: { wave: 1 } },
      { label: "しっかりしていて厚みがある", scores: { straight: 1 } },
      { label: "骨ばっていて角張っている", scores: { natural: 1 } },
    ],
  },
  {
    id: 3,
    question: "首の印象は？",
    options: [
      { label: "細く長め", scores: { wave: 1 } },
      { label: "短めで太め", scores: { straight: 1 } },
      { label: "太めでしっかりしている", scores: { natural: 1 } },
    ],
  },
  {
    id: 4,
    question: "膝の形は？",
    options: [
      { label: "小さくてあまり目立たない", scores: { wave: 1 } },
      { label: "丸みがあってコンパクト", scores: { straight: 1 } },
      { label: "大きくて骨張っている", scores: { natural: 1 } },
    ],
  },
  {
    id: 5,
    question: "鎖骨の見え方は？",
    options: [
      { label: "あまり目立たない", scores: { wave: 1 } },
      { label: "少し見える", scores: { straight: 1 } },
      { label: "くっきり見える・骨張っている", scores: { natural: 1 } },
    ],
  },
  {
    id: 6,
    question: "手の印象は？",
    options: [
      { label: "小さくてやわらかい", scores: { wave: 1 } },
      { label: "やわらかくて厚みがある", scores: { straight: 1 } },
      { label: "大きくて骨っぽい・関節が目立つ", scores: { natural: 1 } },
    ],
  },
  {
    id: 7,
    question: "全体のシルエットの特徴は？",
    options: [
      { label: "上半身が小さく下半身に肉がつきやすい（洋ナシ型）", scores: { wave: 1 } },
      { label: "全体的に筋肉質でメリハリがある（砂時計型）", scores: { straight: 1 } },
      { label: "全体的にフラットで骨格が目立つ（直線的）", scores: { natural: 1 } },
    ],
  },
  {
    id: 8,
    question: "肌の質感は？",
    options: [
      { label: "やわらかくてもちもち", scores: { wave: 1 } },
      { label: "ハリと弾力がある", scores: { straight: 1 } },
      { label: "乾燥しやすくサラッとしている", scores: { natural: 1 } },
    ],
  },
  {
    id: 9,
    question: "胸の位置・バストトップは？",
    options: [
      { label: "やや低めでふんわりしている", scores: { wave: 1 } },
      { label: "位置が高くボリュームがある", scores: { straight: 1 } },
      { label: "やや平坦でボリュームが出にくい", scores: { natural: 1 } },
    ],
  },
  {
    id: 10,
    question: "腰の位置は？",
    options: [
      { label: "低め", scores: { wave: 1 } },
      { label: "高め", scores: { straight: 1 } },
      { label: "どちらでもない・わかりにくい", scores: { natural: 1 } },
    ],
  },
  {
    id: 11,
    question: "体の厚みは？",
    options: [
      { label: "薄め・平面的", scores: { wave: 1 } },
      { label: "厚みがある・立体的", scores: { straight: 1 } },
      { label: "フラットで平ら", scores: { natural: 1 } },
    ],
  },
  {
    id: 12,
    question: "太ももの印象は？",
    options: [
      { label: "太くなりやすい・肉感的", scores: { wave: 1 } },
      { label: "筋肉質でしっかりしている", scores: { straight: 1 } },
      { label: "細くてやせている印象", scores: { natural: 1 } },
    ],
  },
  {
    id: 13,
    question: "ふくらはぎの形は？",
    options: [
      { label: "丸みがあってふくらみやすい", scores: { wave: 1 } },
      { label: "筋肉のラインがわかる", scores: { straight: 1 } },
      { label: "細くて骨のラインが出やすい", scores: { natural: 1 } },
    ],
  },
  {
    id: 14,
    question: "足首の印象は？",
    options: [
      { label: "細くてきれい", scores: { wave: 1 } },
      { label: "ほどよい太さ・しっかりしている", scores: { straight: 1 } },
      { label: "くるぶしの骨が出ている・細い", scores: { natural: 1 } },
    ],
  },
  {
    id: 15,
    question: "体重の変動に対して体型はどう変わる？",
    options: [
      { label: "下半身に肉がつきやすい", scores: { wave: 1 } },
      { label: "全体的に均等につく", scores: { straight: 1 } },
      { label: "あまり体型の変化を感じにくい", scores: { natural: 1 } },
    ],
  },
];

/**
 * 骨格診断を評価する純粋な関数。
 * @param {number[]} answers - 各質問に対する選択肢インデックス（0始まり）の配列
 * @returns {{ type: string, scores: object, confidence: number }}
 */
function evaluateSkeleton(answers) {
  const scores = { straight: 0, wave: 0, natural: 0 };

  for (let i = 0; i < Math.min(answers.length, SKELETON_QUESTIONS.length); i++) {
    const q = SKELETON_QUESTIONS[i];
    const answerIndex = answers[i];
    if (answerIndex == null || answerIndex < 0 || answerIndex >= q.options.length) continue;
    const option = q.options[answerIndex];
    for (const [type, point] of Object.entries(option.scores)) {
      scores[type] = (scores[type] || 0) + point;
    }
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const topType = sorted[0][0];
  const confidence = total > 0 ? sorted[0][1] / total : 0;

  return {
    type: topType,
    scores,
    confidence: Math.round(confidence * 100) / 100,
  };
}

// ─── パーソナルカラー診断 ────────────────────────────────

/**
 * パーソナルカラー診断の10問リスト。
 * spring / summer / autumn / winter の4シーズン。
 */
const COLOR_QUESTIONS = [
  {
    id: 1,
    question: "手首の内側の血管の色は？",
    options: [
      { label: "緑がかっている", scores: { spring: 1, autumn: 1 } },
      { label: "青紫がかっている", scores: { summer: 1, winter: 1 } },
    ],
  },
  {
    id: 2,
    question: "日焼けするとどうなる？",
    options: [
      { label: "赤くなりやすく、あまり黒くならない", scores: { summer: 1, winter: 1 } },
      { label: "わりとすぐ黒くなる", scores: { spring: 1, autumn: 1 } },
    ],
  },
  {
    id: 3,
    question: "似合うアクセサリーの素材は？",
    options: [
      { label: "ゴールド・ブロンズ系", scores: { spring: 1, autumn: 1 } },
      { label: "シルバー・プラチナ系", scores: { summer: 1, winter: 1 } },
    ],
  },
  {
    id: 4,
    question: "肌の色味の印象は？",
    options: [
      { label: "黄みがかっている（イエローベース）", scores: { spring: 1, autumn: 1 } },
      { label: "青みがかっている（ブルーベース）", scores: { summer: 1, winter: 1 } },
    ],
  },
  {
    id: 5,
    question: "目の色は？",
    options: [
      { label: "明るいブラウン・ゴールデンブラウン", scores: { spring: 2 } },
      { label: "やわらかいブラウン・グレーがかったブラウン", scores: { summer: 2 } },
      { label: "濃いダークブラウン・赤みがかったブラウン", scores: { autumn: 2 } },
      { label: "ダークブラウン・ブラック・コントラストが強い", scores: { winter: 2 } },
    ],
  },
  {
    id: 6,
    question: "髪の色（地毛）は？",
    options: [
      { label: "明るいブラウン・やわらかいこげ茶", scores: { spring: 1, autumn: 1 } },
      { label: "アッシュブラウン・グレーがかった茶色", scores: { summer: 2 } },
      { label: "濃いこげ茶・赤みのある黒", scores: { autumn: 1 } },
      { label: "青みのある黒・真っ黒", scores: { winter: 2 } },
    ],
  },
  {
    id: 7,
    question: "白を着たとき顔色はどうなる？",
    options: [
      { label: "顔色が明るく見える・なじむ", scores: { spring: 1, summer: 1, winter: 1 } },
      { label: "顔色が悪く見える・浮いた感じになる", scores: { autumn: 1 } },
    ],
  },
  {
    id: 8,
    question: "黒を着たとき顔色はどうなる？",
    options: [
      { label: "顔色が暗くなる・老けて見える", scores: { spring: 1, summer: 1 } },
      { label: "シャープでかっこよく見える", scores: { winter: 1 } },
      { label: "落ち着いてなじむ", scores: { autumn: 1 } },
    ],
  },
  {
    id: 9,
    question: "得意なカラーグループはどれ？",
    options: [
      { label: "コーラル・ピーチ・明るい黄色など明るくキュートな色", scores: { spring: 2 } },
      { label: "ラベンダー・ローズ・くすんだピンクなどやわらかい色", scores: { summer: 2 } },
      { label: "テラコッタ・カーキ・マスタードなど深みのある色", scores: { autumn: 2 } },
      { label: "ビビッドなレッド・ネイビー・コントラストのある色", scores: { winter: 2 } },
    ],
  },
  {
    id: 10,
    question: "肌の印象は？",
    options: [
      { label: "明るくツヤがある・うすい", scores: { spring: 1 } },
      { label: "やわらかくマットがかっている・ピンク寄り", scores: { summer: 1 } },
      { label: "ツヤと深みがある・濃いめ", scores: { autumn: 1 } },
      { label: "クールでマット・色白または濃い", scores: { winter: 1 } },
    ],
  },
];

/**
 * パーソナルカラー診断を評価する純粋な関数。
 * @param {number[]} answers - 各質問に対する選択肢インデックス（0始まり）の配列
 * @returns {{ type: string, scores: object, confidence: number }}
 */
function evaluateColor(answers) {
  const scores = { spring: 0, summer: 0, autumn: 0, winter: 0 };

  for (let i = 0; i < Math.min(answers.length, COLOR_QUESTIONS.length); i++) {
    const q = COLOR_QUESTIONS[i];
    const answerIndex = answers[i];
    if (answerIndex == null || answerIndex < 0 || answerIndex >= q.options.length) continue;
    const option = q.options[answerIndex];
    for (const [type, point] of Object.entries(option.scores)) {
      scores[type] = (scores[type] || 0) + point;
    }
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const topType = sorted[0][0];
  const confidence = total > 0 ? sorted[0][1] / total : 0;

  return {
    type: topType,
    scores,
    confidence: Math.round(confidence * 100) / 100,
  };
}

// ─── プロフィール保存（ドット記法対応） ──────────────────

/**
 * ドット記法のキー（例: "body.skeleton_type"）でオブジェクトの深い値を設定する。
 * @param {object} obj - 対象オブジェクト
 * @param {string} dotKey - ドット区切りのキーパス
 * @param {unknown} value - 設定する値
 */
function setByDotKey(obj, dotKey, value) {
  const keys = dotKey.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * profile.json を読み込み、指定したキー群を更新して書き戻す。
 * @param {Array<{key: string, value: unknown}>} updates
 * @returns {{ success: boolean, updated: object, profile: object }}
 */
function saveProfileFields(updates) {
  let profile = {};
  try {
    const raw = fs.readFileSync(PROFILE_PATH, "utf-8");
    profile = JSON.parse(raw);
  } catch {
    // 既存ファイルがなければ空オブジェクトから開始
  }

  const updated = {};
  for (const { key, value } of updates) {
    setByDotKey(profile, key, value);
    updated[key] = value;
  }

  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), "utf-8");

  return { success: true, updated, profile };
}

// ─── MCPサーバー定義 ───────────────────────────────────
const server = new Server(
  {
    name: "claude-personal-stylist",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

// ツール一覧
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_profile",
      description:
        "ユーザーのプロフィール（骨格タイプ、パーソナルカラー、好みのテイスト、サイズ等）を取得します",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "scrape_products",
      description:
        "任意のファッションECサイトのURLから商品一覧を取得します。UNIQLO、ZARA、SSENSE、ZOZOTOWN等どんなサイトでも対応。カテゴリページのURLを渡してください。先頭数件の商品画像もインラインで返すため、視覚的に判断できます。",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "スクレイピング対象のURL（商品一覧ページ）",
          },
          max_items: {
            type: "number",
            description: "取得する最大商品数（デフォルト: 20）",
          },
          category: {
            type: "string",
            description: "カテゴリ名（例: tops, bottoms, outerwear）",
          },
          inline_images: {
            type: "number",
            description: "インラインで画像を返す商品数（デフォルト: 5、0で画像なし）",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "scrape_product_detail",
      description:
        "商品詳細ページのURLから、素材・サイズ展開・寸法・カラー等の詳細情報を取得します。サイズ提案に使います。",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "商品詳細ページのURL",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "search_x",
      description:
        "X（旧Twitter）API v2でファッショントレンドを検索します。エンゲージメント順でソート。X_BEARER_TOKENが未設定の場合はセットアップ手順を返します。",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "検索クエリ（例: ユニクロ 名品 2026春）",
          },
          max_results: {
            type: "number",
            description: "最大取得件数（デフォルト: 10）",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "search_trends",
      description:
        "Google検索でファッショントレンド情報を取得します。X検索のフォールバックとしても使えます。直近1ヶ月の記事を優先。",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "検索クエリ（例: ユニクロ おすすめ 2026 春）",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "diagnose_skeleton",
      description:
        "骨格診断ツール。mode='get_questions' で15問の質問リストを返し、mode='evaluate' で回答配列から骨格タイプ（straight/wave/natural）を判定します。",
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["get_questions", "evaluate"],
            description: "get_questions: 質問リストを取得 / evaluate: 回答を評価して判定",
          },
          answers: {
            type: "array",
            items: { type: "number" },
            description:
              "mode='evaluate' のとき必須。各質問への回答選択肢インデックス（0始まり）の配列。長さは1〜15。",
          },
        },
        required: ["mode"],
      },
    },
    {
      name: "diagnose_color",
      description:
        "パーソナルカラー診断ツール。mode='get_questions' で10問の質問リストを返し、mode='evaluate' で回答配列からパーソナルカラー（spring/summer/autumn/winter）を判定します。",
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["get_questions", "evaluate"],
            description: "get_questions: 質問リストを取得 / evaluate: 回答を評価して判定",
          },
          answers: {
            type: "array",
            items: { type: "number" },
            description:
              "mode='evaluate' のとき必須。各質問への回答選択肢インデックス（0始まり）の配列。長さは1〜10。",
          },
        },
        required: ["mode"],
      },
    },
    {
      name: "save_profile",
      description:
        "AIが推奨するプロフィール値をユーザーの承認後にprofile.jsonへ保存します。ドット記法（例: 'body.skeleton_type'）で深いキーの更新が可能。複数キーの一括更新にも対応。",
      inputSchema: {
        type: "object",
        properties: {
          updates: {
            type: "array",
            description: "更新するキーと値のペア一覧",
            items: {
              type: "object",
              properties: {
                key: {
                  type: "string",
                  description: "ドット記法のキーパス（例: 'body.skeleton_type', 'body.personal_color', 'taste.vector'）",
                },
                value: {
                  description: "設定する値（文字列・数値・配列・オブジェクト何でも可）",
                },
              },
              required: ["key", "value"],
            },
          },
        },
        required: ["updates"],
      },
    },
    {
      name: "score_items",
      description: "商品リストをユーザープロフィールに基づいてスコアリング。scrape_productsの結果をプロフィール（骨格・カラー・体型）で評価し、相性スコア(0-100)と理由を付与して返します。",
      inputSchema: {
        type: "object",
        properties: {
          products: {
            type: "array",
            description: "scrape_productsで取得したrawProducts配列",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                link: { type: "string" },
                image: { type: "string" },
                colors: { type: "array", items: { type: "string" } },
                dimensions: { type: "object" },
                category: { type: "string" },
              },
            },
          },
          trend_data: {
            type: "array",
            items: { type: "string" },
            description: "search_x/search_trendsで取得したテキスト配列（オプション）。指定するとTF-IDFコサイン類似度でトレンドスコアを算出します。",
          },
        },
        required: ["products"],
      },
    },
    {
      name: "score_outfit",
      description:
        "コーディネート全体をスコアリング。複数アイテムの「組み合わせ」を8軸（配色・トーン・ドレス/カジュアルバランス・シルエット整合・カラーエコー・素材×季節・レイヤード・TPO）で評価します。score_itemsは単体評価、score_outfitは組み合わせ評価です。",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: "コーデを構成するアイテム配列。各アイテムにname, text, colors, categoryを含める",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "アイテム名" },
                text: { type: "string", description: "商品テキスト（素材・色・シルエット情報）" },
                colors: { type: "array", items: { type: "string" }, description: "カラー名の配列" },
                category: {
                  type: "string",
                  enum: ["tops", "bottoms", "outerwear", "shoes", "accessories", "dress"],
                  description: "アイテムカテゴリ",
                },
              },
            },
          },
          occasion: {
            type: "string",
            enum: ["business", "business_casual", "casual", "date", "formal"],
            description: "シーン・TPO（省略時はcasual想定）",
          },
          season: {
            type: "string",
            enum: ["spring", "summer", "autumn", "winter"],
            description: "季節（省略時は現在の季節を推定）",
          },
        },
        required: ["items"],
      },
    },
    {
      name: "get_styling_rules",
      description: "骨格タイプ・パーソナルカラー・顔タイプ・体型補正・コーデルールの専門知識を取得。提案前に必ず参照すること。",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["skeleton", "color", "face", "body", "coordination", "taste", "all"],
            description: "取得するルールカテゴリ",
          },
          type: {
            type: "string",
            description: "特定のタイプ（例: 'wave', 'summer', 'cute'）。省略時は全タイプ返却",
          },
        },
        required: ["category"],
      },
    },
    {
      name: "diagnose_taste",
      description:
        "テイスト診断ツール。ファッションの好みを5軸（装飾性・フォーマル度・モード感・構築感・遊び心）で数値化します。mode='get_questions'で10問の質問リストを返し、mode='evaluate'で回答からテイストベクトルを算出。mode='from_brands'で好きなブランドからベクトルを推定。",
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["get_questions", "evaluate", "from_brands"],
            description:
              "get_questions: 質問リストを取得 / evaluate: 回答を評価してベクトル算出 / from_brands: 好きなブランドからベクトル推定",
          },
          answers: {
            type: "array",
            items: { type: "number" },
            description:
              "mode='evaluate' のとき必須。各質問への回答選択肢インデックス（0始まり）の配列。長さは1〜10。",
          },
          brands: {
            type: "array",
            items: { type: "string" },
            description:
              "mode='from_brands' のとき必須。好きなブランド名の配列（例: ['Jil Sander', 'UNIQLO', 'COMOLI']）",
          },
        },
        required: ["mode"],
      },
    },
    {
      name: "calibrate",
      description: "ユーザーのフィードバックから推奨寸法の補正値を調整。「前回の着丈提案が長かった」→ top_length_offsetを-1cm調整。使えば使うほどフィット精度が上がります。",
      inputSchema: {
        type: "object",
        properties: {
          dimension: {
            type: "string",
            enum: ["top_length", "shoulder_width", "waist_position", "inseam"],
            description: "調整対象の寸法",
          },
          feedback: {
            type: "string",
            enum: ["too_long", "slightly_long", "perfect", "slightly_short", "too_short"],
            description: "ユーザーのフィードバック",
          },
          context: {
            type: "string",
            description: "フィードバックの文脈（例: 'ユニクロのXXが着丈60cmで少し長かった'）",
          },
        },
        required: ["dimension", "feedback"],
      },
    },
  ],
}));

// ツール実行
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "get_profile": {
      const profile = loadProfile();
      if (!profile) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "no_profile",
                action: "profile.jsonが見つかりません。まず骨格診断(diagnose_skeleton)とパーソナルカラー診断(diagnose_color)を実行してプロフィールを作成してください。",
              }),
            },
          ],
        };
      }

      // 不完全チェック
      const missing = [];
      if (!profile.body?.skeleton_type) missing.push("skeleton_type（骨格タイプ）→ diagnose_skeletonを実行");
      if (!profile.body?.personal_color) missing.push("personal_color（パーソナルカラー）→ diagnose_colorを実行");
      if (!profile.taste?.vector) missing.push("taste.vector（テイスト）→ diagnose_tasteを実行");
      if (!profile.body?.height_cm) missing.push("height_cm（身長）");
      if (!profile.gender) missing.push("gender（性別）");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: missing.length > 0 ? "incomplete" : "complete",
                missing,
                profile,
                instruction: missing.length > 0
                  ? `プロフィールが不完全です。以下の情報が不足しています: ${missing.join(", ")}。まず不足情報を取得してからスタイリング提案に進んでください。`
                  : "プロフィール完備。スタイリング提案可能です。",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "scrape_products": {
      const result = await scrapeProducts(args.url, {
        maxItems: args.max_items || 20,
        category: args.category || "",
        inlineImageCount: args.inline_images ?? 5,
      });

      // 画像をMCP ImageContentブロックとして返す
      const contentBlocks = [];
      const inlineImages = result.inlineImages ?? [];
      for (const img of inlineImages) {
        contentBlocks.push({
          type: "image",
          data: img.data,
          mimeType: img.mimeType,
        });
        contentBlocks.push({
          type: "text",
          text: `↑ 商品${img.index + 1}: ${img.productText}`,
        });
      }

      // テキスト情報（画像データ以外）
      const textResult = { ...result };
      delete textResult.inlineImages;
      contentBlocks.push({
        type: "text",
        text: JSON.stringify(textResult, null, 2),
      });

      return { content: contentBlocks };
    }

    case "scrape_product_detail": {
      const result = await scrapeProductDetail(args.url);

      // レスポンスにMCPのImageContentブロックを含めてClaudeが画像を直接見れるようにする
      const contentBlocks = [];

      // 画像をImageContentとして追加（Claudeのマルチモーダル能力で分析）
      const inlineImages = result.images_base64 ?? [];
      for (const img of inlineImages) {
        contentBlocks.push({
          type: "image",
          data: img.data,
          mimeType: img.mimeType,
        });
      }

      // テキスト情報（画像以外）
      const textResult = { ...result };
      delete textResult.images_base64;
      contentBlocks.push({
        type: "text",
        text: JSON.stringify(textResult, null, 2),
      });

      return { content: contentBlocks };
    }

    case "search_x": {
      const result = await searchX(args.query, args.max_results || 10);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "search_trends": {
      const result = await searchTrends(args.query);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "diagnose_skeleton": {
      const mode = args.mode;

      if (mode === "get_questions") {
        // 選択肢の順序をシャッフルして順序バイアスを防ぐ
        const shuffled = SKELETON_QUESTIONS.map((q) => {
          const indexed = q.options.map((o, idx) => ({ origIndex: idx, label: o.label }));
          for (let i = indexed.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
          }
          return {
            id: q.id,
            question: q.question,
            options: indexed.map((o) => ({ index: o.origIndex, label: o.label })),
          };
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  total: SKELETON_QUESTIONS.length,
                  questions: shuffled,
                  instruction:
                    "各質問に対して選択肢のindex値で回答してください。全問回答後に mode='evaluate' で判定を呼び出してください。",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (mode === "evaluate") {
        if (!Array.isArray(args.answers) || args.answers.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "answers が必要です。各質問への回答インデックス配列を渡してください。",
                }),
              },
            ],
          };
        }

        const result = evaluateSkeleton(args.answers);
        const typeLabels = {
          straight: "ストレート",
          wave: "ウェーブ",
          natural: "ナチュラル",
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...result,
                  type_ja: typeLabels[result.type] ?? result.type,
                  answered: args.answers.length,
                  total: SKELETON_QUESTIONS.length,
                  suggestion:
                    result.confidence >= 0.5
                      ? `骨格タイプは「${typeLabels[result.type]}」と判定しました（確信度 ${Math.round(result.confidence * 100)}%）。プロフィールに保存しますか？`
                      : `スコアが拮抗しています（確信度 ${Math.round(result.confidence * 100)}%）。回答を見直すか、専門家の診断を併用することをお勧めします。`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `不明な mode: ${mode}。'get_questions' または 'evaluate' を指定してください。` }),
          },
        ],
      };
    }

    case "diagnose_color": {
      const mode = args.mode;

      if (mode === "get_questions") {
        const shuffledColor = COLOR_QUESTIONS.map((q) => {
          const indexed = q.options.map((o, idx) => ({ origIndex: idx, label: o.label }));
          for (let i = indexed.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
          }
          return {
            id: q.id,
            question: q.question,
            options: indexed.map((o) => ({ index: o.origIndex, label: o.label })),
          };
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  total: COLOR_QUESTIONS.length,
                  questions: shuffledColor,
                  instruction:
                    "各質問に対して選択肢のindex値で回答してください。全問回答後に mode='evaluate' で判定を呼び出してください。",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (mode === "evaluate") {
        if (!Array.isArray(args.answers) || args.answers.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "answers が必要です。各質問への回答インデックス配列を渡してください。",
                }),
              },
            ],
          };
        }

        const result = evaluateColor(args.answers);
        const typeLabels = {
          spring: "スプリング（春）",
          summer: "サマー（夏）",
          autumn: "オータム（秋）",
          winter: "ウィンター（冬）",
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...result,
                  type_ja: typeLabels[result.type] ?? result.type,
                  answered: args.answers.length,
                  total: COLOR_QUESTIONS.length,
                  suggestion:
                    result.confidence >= 0.4
                      ? `パーソナルカラーは「${typeLabels[result.type]}」と判定しました（確信度 ${Math.round(result.confidence * 100)}%）。プロフィールに保存しますか？`
                      : `スコアが拮抗しています（確信度 ${Math.round(result.confidence * 100)}%）。回答を見直すか、専門家の診断を併用することをお勧めします。`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `不明な mode: ${mode}。'get_questions' または 'evaluate' を指定してください。` }),
          },
        ],
      };
    }

    case "save_profile": {
      if (!Array.isArray(args.updates) || args.updates.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "updates が必要です。{ key, value } の配列を渡してください。",
              }),
            },
          ],
        };
      }

      try {
        const result = saveProfileFields(args.updates);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...result,
                  message: `${args.updates.length}件のフィールドを profile.json に保存しました。`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: err.message }),
            },
          ],
        };
      }
    }

    case "score_items": {
      if (!Array.isArray(args.products) || args.products.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "products が必要です。scrape_products で取得した rawProducts 配列を渡してください。",
              }),
            },
          ],
        };
      }

      // プロフィール読み込み
      const scoreProfile = loadProfile();
      if (!scoreProfile) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "profile.json が見つかりません。まず骨格診断(diagnose_skeleton)とパーソナルカラー診断(diagnose_color)を実行してプロフィールを作成してください。",
              }),
            },
          ],
        };
      }

      // プロフィール完全性チェック（不足分はニュートラル値50で代替してスコアリング続行）
      const scoreMissing = [];
      if (!scoreProfile.body?.skeleton_type) scoreMissing.push("skeleton_type（骨格タイプ）");
      if (!scoreProfile.body?.personal_color) scoreMissing.push("personal_color（パーソナルカラー）");
      if (!scoreProfile.taste?.vector) scoreMissing.push("taste.vector（テイスト）");

      try {
        // ナレッジ読み込み
        const knowledge = loadAllKnowledge();

        // スコアリング実行
        const trendTexts = Array.isArray(args.trend_data) ? args.trend_data : [];
        const ranked = scoreAndRankProducts({
          profile: scoreProfile,
          products: args.products,
          knowledge,
          trendTexts,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  ...(scoreMissing.length > 0 ? { warning: `プロフィール不完全（${scoreMissing.join(", ")}）。該当軸はニュートラル値(50)で代替。` } : {}),
                  count: ranked.length,
                  ranked: ranked.map(({ product, score }) => ({
                    totalScore: score.totalScore,
                    breakdown: score.breakdown,
                    reasoning: score.reasoning,
                    recommendations: score.recommendations,
                    product,
                  })),
                  instruction: `${ranked.length}件の商品をスコアリングしました。totalScore(0-100)が高いほどあなたのプロフィールに合っています。上位アイテムを優先的に提案してください。`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: `スコアリング中にエラーが発生しました: ${err.message}` }),
            },
          ],
        };
      }
    }

    case "score_outfit": {
      if (!Array.isArray(args.items) || args.items.length < 2) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "コーディネート評価には最低2アイテムが必要です。items配列にトップス+ボトムス等を含めてください。",
              }),
            },
          ],
        };
      }

      const outfitProfile = loadProfile() || {};
      const result = scoreOutfit({
        items: args.items,
        profile: outfitProfile,
        occasion: args.occasion || "casual",
        season: args.season || null,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                ...result,
                instruction:
                  "コーディネートの組み合わせ評価結果です。totalScoreが高いほどバランスの良い組み合わせです。breakdownの各軸を確認し、低スコアの軸についてアドバイスしてください。recommendationsに改善提案があります。",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "get_styling_rules": {
      const KNOWLEDGE_DIR = path.join(__dirname, "..", "knowledge");
      const categoryMap = {
        skeleton: "skeleton-types.json",
        color: "personal-colors.json",
        face: "face-types.json",
        body: "body-proportions.json",
        coordination: "coordination-rules.json",
        taste: "taste-axes.json",
      };

      try {
        let result = {};

        if (args.category === "all") {
          // 全カテゴリ読み込み
          for (const [cat, filename] of Object.entries(categoryMap)) {
            const filePath = path.join(KNOWLEDGE_DIR, filename);
            const raw = fs.readFileSync(filePath, "utf-8");
            result[cat] = JSON.parse(raw);
          }
        } else {
          const filename = categoryMap[args.category];
          if (!filename) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ error: `不明なカテゴリ: ${args.category}` }),
                },
              ],
            };
          }
          const filePath = path.join(KNOWLEDGE_DIR, filename);
          const raw = fs.readFileSync(filePath, "utf-8");
          const data = JSON.parse(raw);

          // typeフィルタリング
          if (args.type) {
            const typeKey = args.type;
            // types フィールドがある場合
            if (data.types && data.types[typeKey]) {
              result = { [typeKey]: data.types[typeKey] };
            } else if (data[typeKey]) {
              result = { [typeKey]: data[typeKey] };
            } else {
              result = {
                warning: `タイプ '${typeKey}' が見つかりませんでした。利用可能なタイプ: ${Object.keys(data.types || data).join(", ")}`,
                data,
              };
            }
          } else {
            result = data;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `knowledge読み込みエラー: ${err.message}` }),
            },
          ],
        };
      }
    }

    case "diagnose_taste": {
      const knowledge = loadAllKnowledge();
      const tasteKnowledge = knowledge.taste;

      if (args.mode === "get_questions") {
        const questions = tasteKnowledge.diagnosis_questions.questions.map((q) => {
          // 選択肢をシャッフルして順序バイアスを防止（diagnose_skeleton/colorと同じパターン）
          const indices = q.options.map((_, idx) => idx);
          for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
          }
          return {
            id: q.id,
            text: q.text,
            options: indices.map((origIdx) => ({
              index: origIdx,
              text: q.options[origIdx].text,
            })),
          };
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mode: "get_questions",
                  count: questions.length,
                  questions,
                  instruction:
                    "10問の質問を1問ずつ会話形式で聞いてください。全問回答後、mode='evaluate'で回答配列を送信してベクトルを算出してください。途中回答でも評価可能です。",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (args.mode === "evaluate") {
        if (!Array.isArray(args.answers) || args.answers.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "answers 配列が必要です" }),
              },
            ],
          };
        }
        const questions = tasteKnowledge.diagnosis_questions.questions;
        const { vector, answered } = evaluateDiagnosis(args.answers, questions);
        const topArchetypes = findTopArchetypes(
          vector,
          tasteKnowledge.style_labels.archetypes,
          3
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mode: "evaluate",
                  vector,
                  answered,
                  primary_style: topArchetypes[0] ?? null,
                  secondary_styles: topArchetypes.slice(1),
                  instruction:
                    "結果をユーザーに説明し、共感したらsave_profileでtaste.vectorに保存してください。ブランド情報もあればfrom_brandsで補正することを推奨します。",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (args.mode === "from_brands") {
        if (!Array.isArray(args.brands) || args.brands.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "brands 配列が必要です" }),
              },
            ],
          };
        }
        const brandVectors = tasteKnowledge.brand_vectors.brands;
        const { vector, matchedBrands, unmatchedBrands } =
          estimateVectorFromBrands(args.brands, brandVectors);
        const topArchetypes = findTopArchetypes(
          vector,
          tasteKnowledge.style_labels.archetypes,
          3
        );

        // 既存の診断ベクトルがある場合は平均を提案
        const profile = loadProfile();
        const existingVector = profile?.taste?.vector ?? null;
        let mergedVector = null;
        if (existingVector) {
          mergedVector = {};
          for (const axis of Object.keys(vector)) {
            mergedVector[axis] = Math.round(
              (existingVector[axis] + vector[axis]) / 2
            );
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mode: "from_brands",
                  vector,
                  matchedBrands,
                  unmatchedBrands,
                  primary_style: topArchetypes[0] ?? null,
                  secondary_styles: topArchetypes.slice(1),
                  merged_vector: mergedVector,
                  instruction: mergedVector
                    ? "質問診断のベクトルとブランド推定ベクトルの平均(merged_vector)をsave_profileでtaste.vectorに保存することを推奨します。"
                    : "結果をユーザーに説明し、共感したらsave_profileでtaste.vectorに保存してください。",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `不正なmode: ${args.mode}。get_questions / evaluate / from_brands のいずれかを指定してください。`,
            }),
          },
        ],
      };
    }

    case "calibrate": {
      const ADJUSTMENT_MAP = {
        too_long: -2,
        slightly_long: -1,
        perfect: 0,
        slightly_short: 1,
        too_short: 2,
      };

      const profile = loadProfile();
      if (!profile) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "profile.json が見つかりません。まず骨格診断(diagnose_skeleton)とパーソナルカラー診断(diagnose_color)を実行してプロフィールを作成してください。" }),
            },
          ],
        };
      }

      if (!profile.calibration) {
        profile.calibration = {
          top_length_offset: 0,
          shoulder_width_offset: 0,
          waist_position_offset: 0,
          inseam_offset: 0,
          feedback_history: [],
        };
      }
      if (!Array.isArray(profile.calibration.feedback_history)) {
        profile.calibration.feedback_history = [];
      }

      const offset = ADJUSTMENT_MAP[args.feedback] ?? 0;
      const key = `${args.dimension}_offset`;
      profile.calibration[key] = (profile.calibration[key] || 0) + offset;

      // フィードバック履歴に追加（最大20件）
      profile.calibration.feedback_history.push({
        dimension: args.dimension,
        feedback: args.feedback,
        context: args.context || "",
        offset_applied: offset,
        timestamp: new Date().toISOString(),
      });
      if (profile.calibration.feedback_history.length > 20) {
        profile.calibration.feedback_history = profile.calibration.feedback_history.slice(-20);
      }

      // calibration オブジェクト全体を保存
      const updates = [
        { key: `calibration.${key}`, value: profile.calibration[key] },
        { key: "calibration.feedback_history", value: profile.calibration.feedback_history },
      ];
      saveProfileFields(updates);

      const signStr = offset > 0 ? `+${offset}` : String(offset);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                dimension: args.dimension,
                feedback: args.feedback,
                offset_applied: offset,
                new_offset: profile.calibration[key],
                message: `${args.dimension}の補正値を${signStr}cm調整しました（累計: ${profile.calibration[key]}cm）`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    default:
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) },
        ],
      };
  }
});

// ─── MCPプロンプト定義 ─────────────────────────────────

// プロンプト一覧
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "stylist",
      description: "AI Personal Stylistのシステムプロンプト。会話開始時に参照。",
    },
  ],
}));

// プロンプト取得
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;
  if (name === "stylist") {
    const promptContent = fs.readFileSync(
      path.join(__dirname, "..", "prompts", "stylist.md"),
      "utf-8"
    );
    return {
      messages: [
        {
          role: "user",
          content: { type: "text", text: promptContent },
        },
      ],
    };
  }
  throw new Error(`不明なプロンプト: ${name}`);
});

// ─── 起動 ──────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Claude-Personal-Stylist MCP Server running");
}

main().catch(console.error);
