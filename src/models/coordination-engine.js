/**
 * コーディネートスコアリングエンジン
 * 複数アイテムの「組み合わせ」を評価する。単体スコアとは独立。
 *
 * スタイリストの頭の中: 「この3つを合わせるとIラインになって、配色は3色以内で、
 * ドレス:カジュアル=6:4のスマートカジュアルに仕上がる」
 *
 * 8つの評価軸:
 *   1. 3色ルール遵守 (20%)
 *   2. トーン調和 (15%)
 *   3. ドレス/カジュアルバランス (15%)
 *   4. シルエット整合 (15%)
 *   5. カラーエコー (10%)
 *   6. 素材×季節適合 (10%)
 *   7. レイヤード品質 (10%)
 *   8. TPO適合 (5%)
 *
 * ES Module形式 / 外部パッケージ不使用 / Pure functions only
 */

// ─── 定数 ──────────────────────────────────────────────────────────

const COORD_WEIGHTS = {
  threeColor: 0.20,
  toneHarmony: 0.15,
  dressCasual: 0.15,
  silhouette: 0.15,
  colorEcho: 0.10,
  materialSeason: 0.10,
  layering: 0.10,
  tpo: 0.05,
};

// ─── カラー分類 ──────────────────────────────────────────────────

const BASE_COLORS = new Set([
  "ホワイト", "白", "ブラック", "黒", "グレー", "灰",
  "ネイビー", "紺", "ベージュ", "カーキ", "アイボリー",
  "white", "black", "gray", "grey", "navy", "beige", "khaki", "ivory",
  "charcoal", "cream", "ecru", "taupe",
]);

const ACCENT_COLORS = new Set([
  "レッド", "赤", "イエロー", "黄", "オレンジ", "橙",
  "コーラル", "ゴールド", "金", "ターコイズ", "マゼンタ",
  "ネオン", "蛍光", "ビビッド",
  "red", "yellow", "orange", "coral", "gold", "turquoise",
  "magenta", "neon", "vivid", "fuchsia",
]);

// ─── トーン分類 ──────────────────────────────────────────────────

const TONE_MAP = {
  "白": "light", "ホワイト": "light", "white": "light", "アイボリー": "light", "ivory": "light",
  "cream": "light", "ベージュ": "light", "beige": "light", "ペール": "light", "パステル": "light",
  "ライトグレー": "light", "ライトブルー": "light",
  "グレー": "mid", "gray": "mid", "grey": "mid", "カーキ": "mid", "khaki": "mid",
  "ブルー": "mid", "blue": "mid", "グリーン": "mid", "green": "mid",
  "ブラウン": "mid", "brown": "mid", "ピンク": "mid", "pink": "mid",
  "ラベンダー": "mid", "ミント": "mid",
  "ブラック": "dark", "黒": "dark", "black": "dark", "ネイビー": "dark", "紺": "dark",
  "navy": "dark", "charcoal": "dark", "チャコール": "dark",
  "ダークグリーン": "dark", "バーガンディ": "dark", "burgundy": "dark",
  "レッド": "vivid", "赤": "vivid", "red": "vivid", "オレンジ": "vivid", "orange": "vivid",
  "イエロー": "vivid", "yellow": "vivid", "ビビッド": "vivid", "ネオン": "vivid",
};

// ─── ドレスレベル分類 ────────────────────────────────────────────

const DRESS_ITEMS = new Set([
  "テーラード", "ジャケット", "ブレザー", "スラックス", "シャツ",
  "ブラウス", "スーツ", "セットアップ", "ローファー", "革靴",
  "ヒール", "パンプス", "ドレス", "タイ", "ネクタイ",
  "tailored", "jacket", "blazer", "slacks", "blouse", "suit",
  "loafer", "oxford", "pumps", "heels", "dress-shoe",
]);

const CASUAL_ITEMS = new Set([
  "Tシャツ", "パーカー", "スウェット", "デニム", "ジーンズ",
  "スニーカー", "サンダル", "ショートパンツ", "カーゴ",
  "ジャージ", "キャップ", "バックパック", "リュック",
  "t-shirt", "hoodie", "sweatshirt", "denim", "jeans",
  "sneaker", "sandal", "shorts", "cargo", "jersey", "cap", "backpack",
]);

// ─── 季節×素材 ──────────────────────────────────────────────────

const SEASON_MATERIALS = {
  spring: {
    good: ["コットン", "cotton", "リネン", "linen", "シフォン", "chiffon", "シルク", "silk", "薄手ニット"],
    avoid: ["ダウン", "down", "厚手ウール", "ボア", "フリース"],
  },
  summer: {
    good: ["リネン", "linen", "コットン", "cotton", "レーヨン", "rayon", "メッシュ", "mesh", "シアー"],
    avoid: ["ウール", "wool", "ベルベット", "velvet", "コーデュロイ", "corduroy", "厚手デニム"],
  },
  autumn: {
    good: ["コーデュロイ", "corduroy", "ツイード", "tweed", "ウール", "wool", "スエード", "suede", "フランネル", "flannel", "デニム", "denim"],
    avoid: ["シアー", "sheer", "メッシュ", "mesh"],
  },
  winter: {
    good: ["ウール", "wool", "カシミヤ", "cashmere", "ダウン", "down", "ニット", "knit", "フリース", "fleece", "スエード", "suede", "モヘア"],
    avoid: ["リネン", "linen", "シフォン", "chiffon", "メッシュ", "mesh"],
  },
};

// ─── TPOルール ──────────────────────────────────────────────────

const TPO_AVOID = {
  business: ["スニーカー", "sneaker", "パーカー", "hoodie", "Tシャツ", "t-shirt", "デニム", "denim", "ショートパンツ", "shorts", "サンダル", "sandal", "キャップ", "cap"],
  business_casual: ["パーカー", "hoodie", "ショートパンツ", "shorts", "サンダル", "sandal", "ジャージ", "jersey"],
  casual: [],
  date: ["ジャージ", "jersey", "スウェットパンツ", "sweatpants"],
  formal: ["スニーカー", "sneaker", "デニム", "denim", "Tシャツ", "t-shirt", "パーカー", "hoodie", "ショートパンツ", "shorts", "サンダル", "sandal"],
};

const TPO_DRESS_TARGET = {
  business: 85,
  business_casual: 65,
  casual: 30,
  date: 60,
  formal: 90,
};

// ─── ヘルパー ──────────────────────────────────────────────────

function clamp(min, max, val) {
  return Math.max(min, Math.min(max, val));
}

/**
 * アイテムテキストからカラーを抽出する簡易パーサー
 */
function extractColors(text) {
  if (!text) return [];
  const normalized = text.toLowerCase();
  const found = [];
  const allColors = [...BASE_COLORS, ...ACCENT_COLORS,
    "ブルー", "blue", "グリーン", "green", "ブラウン", "brown",
    "ピンク", "pink", "パープル", "purple", "ラベンダー", "lavender",
    "バーガンディ", "burgundy", "キャメル", "camel", "マスタード", "mustard",
  ];
  for (const color of allColors) {
    if (normalized.includes(color.toLowerCase())) {
      found.push(color);
    }
  }
  return [...new Set(found)];
}

/**
 * カラーのロール分類 (base / assort / accent)
 */
function classifyColorRole(color) {
  const lc = color.toLowerCase();
  if ([...BASE_COLORS].some((c) => lc.includes(c.toLowerCase()))) return "base";
  if ([...ACCENT_COLORS].some((c) => lc.includes(c.toLowerCase()))) return "accent";
  return "assort";
}

/**
 * カラーのトーン推定
 */
function estimateTone(color) {
  const lc = color.toLowerCase();
  for (const [key, tone] of Object.entries(TONE_MAP)) {
    if (lc.includes(key.toLowerCase())) return tone;
  }
  return "mid";
}

/**
 * テキストからドレスレベルを計算 (0=full casual, 100=full dress)
 */
function computeDressLevel(text) {
  if (!text) return 50;
  const lc = text.toLowerCase();
  let dressHits = 0;
  let casualHits = 0;
  for (const kw of DRESS_ITEMS) {
    if (lc.includes(kw.toLowerCase())) dressHits++;
  }
  for (const kw of CASUAL_ITEMS) {
    if (lc.includes(kw.toLowerCase())) casualHits++;
  }
  const total = dressHits + casualHits;
  if (total === 0) return 50;
  return Math.round((dressHits / total) * 100);
}

/**
 * テキストからシルエットタイプを推定
 */
function detectSilhouetteContribution(text, category) {
  if (!text) return "neutral";
  const lc = text.toLowerCase();

  // Tops
  if (category === "tops" || category === "outerwear") {
    if (/オーバーサイズ|ビッグ|ボリューム|ワイド/.test(lc)) return "volume_top";
    if (/スリム|フィット|タイト|コンパクト/.test(lc)) return "fitted_top";
    return "neutral_top";
  }
  // Bottoms
  if (category === "bottoms") {
    if (/フレア|ワイド|プリーツ|aライン/.test(lc)) return "flare_bottom";
    if (/スキニー|テーパード|スリム|ストレート|ペンシル/.test(lc)) return "fitted_bottom";
    return "neutral_bottom";
  }
  return "neutral";
}

/**
 * top + bottom のシルエット組み合わせからライン判定
 */
function determineOutfitLine(topSil, bottomSil) {
  if (topSil === "volume_top" && bottomSil === "fitted_bottom") return "Y";
  if (topSil === "fitted_top" && bottomSil === "flare_bottom") return "A";
  if (topSil === "fitted_top" && bottomSil === "fitted_bottom") return "I";
  if (topSil === "volume_top" && bottomSil === "flare_bottom") return "O";
  // X-line needs waist mark detection — approximate
  return "I"; // default to I-line
}

// ─── 個別スコアリング関数 ────────────────────────────────────────

/**
 * 1. 3色ルール遵守スコア
 */
function scoreThreeColorRule(outfitColors) {
  const uniqueColors = [...new Set(outfitColors.map((c) => c.toLowerCase()))];
  const count = uniqueColors.length;

  if (count === 0) return { score: 50, reasoning: "カラー情報なし" };
  if (count <= 3) {
    const roles = uniqueColors.map(classifyColorRole);
    const hasBase = roles.includes("base");
    const roleBonus = hasBase ? 10 : 0;
    return {
      score: clamp(0, 100, 80 + roleBonus),
      reasoning: `${count}色使い（${uniqueColors.join("+")}）— 3色ルール遵守`,
    };
  }
  if (count === 4) {
    return { score: 40, reasoning: `${count}色使い — やや多い。アクセントを1色減らすとまとまりが出ます` };
  }
  return { score: 15, reasoning: `${count}色使い — 多すぎ。3色以内に絞ることを推奨` };
}

/**
 * 2. トーン調和スコア
 */
function scoreToneHarmony(outfitColors) {
  if (outfitColors.length === 0) return { score: 50, reasoning: "カラー情報なし" };

  const tones = outfitColors.map(estimateTone);
  const uniqueTones = [...new Set(tones)];

  if (uniqueTones.length === 1) {
    return { score: 95, reasoning: `同トーン配色（${uniqueTones[0]}）— 統一感◎` };
  }

  // Gradation: light→mid→dark
  const toneOrder = ["light", "mid", "dark"];
  const sorted = [...uniqueTones].sort((a, b) => toneOrder.indexOf(a) - toneOrder.indexOf(b));
  const isGradation = sorted.every((t, i) => i === 0 || toneOrder.indexOf(t) >= toneOrder.indexOf(sorted[i - 1]));

  if (isGradation && uniqueTones.length <= 3 && !uniqueTones.includes("vivid")) {
    return { score: 80, reasoning: "グラデーション配色 — 自然な濃淡の流れ" };
  }

  // Contrast: light + dark
  if (uniqueTones.includes("light") && uniqueTones.includes("dark") && uniqueTones.length === 2) {
    return { score: 75, reasoning: "コントラスト配色 — 明暗のメリハリ" };
  }

  // Vivid mixed with muted
  if (uniqueTones.includes("vivid") && uniqueTones.length <= 3) {
    return { score: 65, reasoning: "ビビッドアクセント配色 — 差し色が効果的" };
  }

  return { score: 40, reasoning: "トーンにまとまりがない — 明度・彩度を揃えると改善" };
}

/**
 * 3. ドレス/カジュアルバランススコア
 */
function scoreDressCasualBalance(items, occasion) {
  if (items.length === 0) return { score: 50, reasoning: "アイテム情報なし" };

  const levels = items.map((item) => computeDressLevel(item.text ?? item.name ?? ""));
  const avgLevel = Math.round(levels.reduce((s, l) => s + l, 0) / levels.length);
  const target = TPO_DRESS_TARGET[occasion] ?? 50;
  const distance = Math.abs(avgLevel - target);

  const score = clamp(0, 100, 100 - distance * 1.5);
  const levelLabel = avgLevel >= 70 ? "ドレス寄り" : avgLevel >= 40 ? "バランス型" : "カジュアル寄り";
  const targetLabel = occasion ? `${occasion}想定` : "汎用";

  return {
    score,
    reasoning: `${levelLabel}（${avgLevel}%）— ${targetLabel}の理想値${target}%に対して${distance > 15 ? "ギャップあり" : "適合"}`,
  };
}

/**
 * 4. シルエット整合スコア
 */
function scoreSilhouetteCoherence(items, bodyType) {
  const tops = items.filter((i) => i.category === "tops" || i.category === "outerwear");
  const bottoms = items.filter((i) => i.category === "bottoms");

  if (tops.length === 0 || bottoms.length === 0) {
    return { score: 50, reasoning: "トップスまたはボトムスが不足 — シルエット評価不可" };
  }

  const topSil = detectSilhouetteContribution(tops[0].text ?? tops[0].name ?? "", tops[0].category);
  const bottomSil = detectSilhouetteContribution(bottoms[0].text ?? bottoms[0].name ?? "", bottoms[0].category);
  const outfitLine = determineOutfitLine(topSil, bottomSil);

  // 骨格タイプとの相性
  const lineBodyMatch = {
    straight: { I: 90, Y: 60, A: 50, X: 70, O: 30 },
    wave: { I: 50, Y: 60, A: 80, X: 95, O: 40 },
    natural: { I: 50, Y: 85, A: 60, X: 40, O: 80 },
  };

  const matchScore = lineBodyMatch[bodyType]?.[outfitLine] ?? 60;

  return {
    score: matchScore,
    reasoning: `${outfitLine}ライン — ${bodyType ?? "不明"}タイプとの相性${matchScore >= 80 ? "◎" : matchScore >= 60 ? "○" : "△"}`,
  };
}

/**
 * 5. カラーエコー（色の呼応）スコア
 */
function scoreColorEcho(outfitColors) {
  if (outfitColors.length < 2) return { score: 50, reasoning: "アイテム不足" };

  // 同じ色が複数アイテムに使われている = エコー
  const colorCounts = {};
  for (const c of outfitColors) {
    const lc = c.toLowerCase();
    colorCounts[lc] = (colorCounts[lc] || 0) + 1;
  }

  const echoed = Object.entries(colorCounts).filter(([, n]) => n >= 2);
  if (echoed.length > 0) {
    const echoedNames = echoed.map(([c]) => c).join(", ");
    return { score: 85, reasoning: `${echoedNames}が複数アイテムで呼応 — 統一感◎` };
  }

  // ベースカラーが存在する場合
  const hasBase = outfitColors.some((c) => classifyColorRole(c) === "base");
  if (hasBase) {
    return { score: 65, reasoning: "ベースカラーで土台が安定 — アクセントの呼応があるとさらに◎" };
  }

  return { score: 40, reasoning: "色の呼応がない — 小物で色をリピートすると改善" };
}

/**
 * 6. 素材×季節適合スコア
 */
function scoreMaterialSeason(items, season) {
  if (!season || items.length === 0) return { score: 50, reasoning: "季節情報なし" };

  const seasonData = SEASON_MATERIALS[season];
  if (!seasonData) return { score: 50, reasoning: `不明な季節: ${season}` };

  let goodCount = 0;
  let avoidCount = 0;
  let totalChecked = 0;

  for (const item of items) {
    const text = (item.text ?? item.name ?? "").toLowerCase();
    for (const mat of seasonData.good) {
      if (text.includes(mat.toLowerCase())) { goodCount++; totalChecked++; break; }
    }
    for (const mat of seasonData.avoid) {
      if (text.includes(mat.toLowerCase())) { avoidCount++; break; }
    }
  }

  const score = clamp(0, 100, 50 + goodCount * 20 - avoidCount * 30);
  const parts = [];
  if (goodCount > 0) parts.push(`季節適合素材${goodCount}点`);
  if (avoidCount > 0) parts.push(`非推奨素材${avoidCount}点`);
  if (parts.length === 0) parts.push("素材情報不足");

  return { score, reasoning: `${season}: ${parts.join(", ")}` };
}

/**
 * 7. レイヤード品質スコア
 */
function scoreLayering(items) {
  // 3アイテム未満はレイヤードなし → ニュートラル
  if (items.length < 3) return { score: 70, reasoning: "レイヤードなし（2アイテム以下）" };

  let score = 60; // ベースライン
  const reasons = [];

  // 素材の多様性チェック
  const materials = items.map((i) => (i.text ?? i.name ?? "").toLowerCase());
  const hasMaterialVariety = new Set(materials).size >= 2;
  if (hasMaterialVariety) {
    score += 15;
    reasons.push("素材に変化あり");
  } else {
    reasons.push("素材が単調 — 異素材ミックスを推奨");
  }

  // フィット感の段階チェック（内→外で緩く）
  const categories = items.map((i) => i.category);
  const hasOuter = categories.includes("outerwear");
  if (hasOuter) {
    score += 15;
    reasons.push("アウター+インナーの重ね着構造あり");
  }

  return {
    score: clamp(0, 100, score),
    reasoning: reasons.join(" / ") || "レイヤード評価",
  };
}

/**
 * 8. TPO適合スコア
 */
function scoreTpo(items, occasion) {
  if (!occasion) return { score: 50, reasoning: "TPO未指定" };

  const avoidList = TPO_AVOID[occasion] ?? [];
  if (avoidList.length === 0) return { score: 80, reasoning: `${occasion}: 特段の制約なし` };

  let violations = 0;
  const violationDetails = [];

  for (const item of items) {
    const text = (item.text ?? item.name ?? "").toLowerCase();
    for (const avoidWord of avoidList) {
      if (text.includes(avoidWord.toLowerCase())) {
        violations++;
        violationDetails.push(`${avoidWord}(${item.name ?? item.text?.slice(0, 20) ?? "?"})`);
        break;
      }
    }
  }

  const score = clamp(0, 100, 100 - violations * 25);
  const reasoning = violations > 0
    ? `${occasion}でNG: ${violationDetails.join(", ")}`
    : `${occasion}に適合`;

  return { score, reasoning };
}

// ─── メインスコアリング関数 ─────────────────────────────────────

/**
 * コーディネート全体をスコアリング
 *
 * @param {Object} params
 * @param {Object[]} params.items - アイテム配列 [{ name, text, colors, category, ... }]
 * @param {Object} params.profile - profile.json
 * @param {string} [params.occasion] - TPO (business, business_casual, casual, date, formal)
 * @param {string} [params.season] - 季節 (spring, summer, autumn, winter)
 * @returns {{ totalScore: number, breakdown: Object, reasoning: string[], recommendations: string[] }}
 */
export function scoreOutfit({ items, profile, occasion, season }) {
  if (!Array.isArray(items) || items.length < 2) {
    return {
      totalScore: 0,
      breakdown: {},
      reasoning: ["コーディネート評価には最低2アイテムが必要です"],
      recommendations: [],
    };
  }

  // 全アイテムからカラーを収集
  const allColors = [];
  for (const item of items) {
    const colors = item.colors ?? extractColors(item.text ?? item.name ?? "");
    allColors.push(...colors);
  }

  const bodyType = profile?.body?.skeleton_type ?? null;

  // 8軸スコアリング
  const threeColor = scoreThreeColorRule(allColors);
  const toneHarmony = scoreToneHarmony(allColors);
  const dressCasual = scoreDressCasualBalance(items, occasion);
  const silhouette = scoreSilhouetteCoherence(items, bodyType);
  const colorEcho = scoreColorEcho(allColors);
  const materialSeason = scoreMaterialSeason(items, season);
  const layering = scoreLayering(items);
  const tpo = scoreTpo(items, occasion);

  const breakdown = {
    threeColorRule: threeColor,
    toneHarmony,
    dressCasualBalance: dressCasual,
    silhouetteCoherence: silhouette,
    colorEcho,
    materialSeasonMatch: materialSeason,
    layeringQuality: layering,
    tpoCompliance: tpo,
  };

  // 加重平均
  const totalScore = Math.round(
    threeColor.score * COORD_WEIGHTS.threeColor +
    toneHarmony.score * COORD_WEIGHTS.toneHarmony +
    dressCasual.score * COORD_WEIGHTS.dressCasual +
    silhouette.score * COORD_WEIGHTS.silhouette +
    colorEcho.score * COORD_WEIGHTS.colorEcho +
    materialSeason.score * COORD_WEIGHTS.materialSeason +
    layering.score * COORD_WEIGHTS.layering +
    tpo.score * COORD_WEIGHTS.tpo
  );

  // reasoning
  const reasoning = Object.values(breakdown).map((b) => b.reasoning);

  // recommendations
  const recommendations = [];
  if (threeColor.score < 50) recommendations.push("色数を3色以内に絞りましょう。アクセントは小物1点に集約するのが効果的です。");
  if (toneHarmony.score < 50) recommendations.push("トーン（明度・彩度）を揃えると統一感が出ます。同系色のグラデーションが最も簡単な手法です。");
  if (dressCasual.score < 50) recommendations.push("ドレス/カジュアルのバランスを調整してください。靴を変えるだけでも大きく印象が変わります。");
  if (silhouette.score < 50) recommendations.push("シルエットのバランスを見直してください。上下どちらかにボリュームを寄せるとメリハリが出ます。");
  if (materialSeason.score < 40) recommendations.push("季節に合わない素材が含まれています。見直してください。");
  if (tpo.score < 50) recommendations.push("TPOに合わないアイテムが含まれています。シーンに合わせたアイテム選びを検討してください。");
  if (recommendations.length === 0 && totalScore >= 70) {
    recommendations.push("バランスの取れたコーディネートです。");
  }

  return { totalScore, breakdown, reasoning, recommendations };
}
