/**
 * Niche Analytics Engine
 * Calculates real-time market statistics for a batch of products.
 * Includes Trust Score (§3 of spec) and Relevance Score (semantic noun-matching).
 */

// Common stop-words and noise to strip when extracting nouns
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','into','onto','upon','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','shall','should','may',
  'might','must','can','could','that','which','who','whom','this','these',
  'those','it','its','i','me','my','we','us','our','you','your','he','him',
  'his','she','her','they','them','their','what','where','when','how','all',
  'each','every','both','few','more','most','other','some','such','no','not',
  'only','own','same','so','than','too','very','just','new','free','sale',
  'hot','top','best','high','quality','premium','luxury','original','official',
  'genuine','brand','set','kit','pack','pcs','piece','pieces','lot','style',
  'fashion','shipping','fast','portable','mini','pro','max','plus','ultra',
  'super','wholesale','retail','bulk','2024','2025','2026'
]);

/**
 * Extract meaningful nouns/tokens from a text string
 * @param {string} text
 * @returns {string[]} lowercase tokens, 2+ chars, stop-words removed
 */
function extractNouns(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * Calculate Relevance Score via semantic noun overlap.
 * Measures what fraction of query nouns appear in the product title.
 *
 * relevanceScore = (matched_nouns / total_query_nouns) × 100
 *
 * @param {string} query - Original search query
 * @param {string} title - Product title
 * @returns {number} 0–100
 */
function calcRelevanceScore(query, title) {
  const queryNouns = extractNouns(query);
  if (queryNouns.length === 0) return 100; // no nouns → can't filter, assume relevant
  const titleLower = (title || '').toLowerCase();
  let matched = 0;
  for (const noun of queryNouns) {
    if (titleLower.includes(noun)) matched++;
  }
  return Math.round((matched / queryNouns.length) * 100 * 10) / 10;
}

/**
 * Filter products by relevance threshold.
 * Products below the threshold are removed.
 *
 * @param {Object[]} products
 * @param {string} query
 * @param {number} threshold - Minimum relevance score (default 25)
 * @returns {{ relevant: Object[], droppedCount: number }}
 */
function filterByRelevance(products, query, threshold = 25) {
  if (!Array.isArray(products) || !query) return { relevant: products || [], droppedCount: 0 };
  let droppedCount = 0;
  const relevant = products.filter(p => {
    const score = calcRelevanceScore(query, p.title);
    p.relevanceScore = score;
    if (score < threshold) {
      droppedCount++;
      return false;
    }
    return true;
  });
  return { relevant, droppedCount };
}

/**
 * Parse numeric price from string (strips currency symbols, commas)
 * @param {string|number} priceStr
 * @returns {number}
 */
function parsePrice(priceStr) {
  if (typeof priceStr === 'number') return priceStr;
  if (!priceStr) return 0;
  const match = String(priceStr).match(/[\d,]+\.?\d*/);
  return match ? parseFloat(match[0].replace(/,/g, '')) : 0;
}

/**
 * Calculate median of a sorted numeric array
 * @param {number[]} sorted
 * @returns {number}
 */
function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate Trust Score for a single product given batch context
 *
 * trust_score = (0.45 × rating_norm) + (0.35 × sales_norm) + (0.20 × price_norm)
 *
 * @param {Object} product
 * @param {number} maxSales - max totalSales in the batch
 * @param {number} medianPrice - median price in the batch
 * @returns {number} 0–100
 */
function calcTrustScore(product, maxSales, medianPrice) {
  const rating = typeof product.rating === 'number' ? product.rating : 0;
  const sales = typeof product.totalSales === 'number' ? product.totalSales : 0;
  const price = product.priceNumeric || parsePrice(product.price);

  const ratingNorm = (Math.min(rating, 5) / 5) * 100;
  const salesNorm = maxSales > 0 ? Math.min((sales / maxSales) * 100, 100) : 0;

  let priceNorm = 100;
  if (medianPrice > 0) {
    const deviation = Math.abs(price - medianPrice) / medianPrice;
    priceNorm = Math.max(0, Math.min(100, 100 - deviation * 100));
  }

  const score = 0.45 * ratingNorm + 0.35 * salesNorm + 0.20 * priceNorm;
  return Math.round(score * 10) / 10;
}

/**
 * Calculate discount percentage
 * @param {string|number} salePrice
 * @param {string|number} originalPrice
 * @returns {number} 0–100
 */
function calcDiscountPct(salePrice, originalPrice) {
  const sale = parsePrice(salePrice);
  const original = parsePrice(originalPrice);
  if (original <= 0 || sale <= 0 || sale >= original) return 0;
  return Math.round(((1 - sale / original) * 100) * 10) / 10;
}

/**
 * Determine market position percentile label
 * @param {number} rank - 0-based rank in batch (sorted by score desc)
 * @param {number} total
 * @returns {string}
 */
function marketPosition(rank, total) {
  if (total === 0) return 'mid';
  const pct = rank / total;
  if (pct <= 0.10) return 'top_10pct';
  if (pct <= 0.20) return 'top_20pct';
  if (pct <= 0.60) return 'mid';
  return 'low';
}

/**
 * Enrich a batch of products with analytics fields (trustScore, discountPct, etc.)
 * and compute aggregate niche analytics.
 *
 * @param {Object[]} products - Raw products from API
 * @returns {{ enrichedProducts: Object[], nicheAnalytics: Object }}
 */
function analyzeNiche(products, query) {
  if (!Array.isArray(products) || products.length === 0) {
    return {
      enrichedProducts: [],
      nicheAnalytics: {
        avgPrice: 0, minPrice: 0, maxPrice: 0, medianPrice: 0,
        maxDiscountProduct: null,
        totalNicheVolume: 0,
        competitionIndex: 0,
        topRatedCount: 0,
        lowRatedCount: 0,
        totalAnalyzed: 0
      }
    };
  }

  // Pre-compute numeric prices and discount %
  const enriched = products.map(p => ({
    ...p,
    priceNumeric: parsePrice(p.price),
    discountPct: calcDiscountPct(p.price, p.originalPrice)
  }));

  // Sorted prices for stats
  const prices = enriched.map(p => p.priceNumeric).filter(p => p > 0).sort((a, b) => a - b);
  const medianPriceVal = median(prices);
  const maxSales = Math.max(...enriched.map(p => p.totalSales || 0), 1);

  // Compute trust scores and relevance scores
  enriched.forEach(p => {
    p.trustScore = calcTrustScore(p, maxSales, medianPriceVal);
    if (query && typeof p.relevanceScore === 'undefined') {
      p.relevanceScore = calcRelevanceScore(query, p.title);
    }
  });

  // Sort by trust score descending for market position
  const sorted = [...enriched].sort((a, b) => b.trustScore - a.trustScore);
  const rankMap = new Map();
  sorted.forEach((p, idx) => rankMap.set(p.productId, idx));

  enriched.forEach(p => {
    const rank = rankMap.get(p.productId) || 0;
    p.marketPosition = marketPosition(rank, enriched.length);
  });

  // Find max discount product
  let maxDiscountProduct = null;
  let maxDiscount = 0;
  for (const p of enriched) {
    if (p.discountPct > maxDiscount) {
      maxDiscount = p.discountPct;
      maxDiscountProduct = {
        productId: p.productId,
        title: p.title,
        discountPct: p.discountPct,
        price: p.price,
        originalPrice: p.originalPrice
      };
    }
  }

  // Competition index
  const topRatedCount = enriched.filter(p => typeof p.rating === 'number' && p.rating >= 4.5).length;
  const lowRatedCount = enriched.filter(p => typeof p.rating === 'number' && p.rating > 0 && p.rating < 4.0).length;
  const competitionIndex = (topRatedCount + lowRatedCount) > 0
    ? Math.round((topRatedCount / (topRatedCount + lowRatedCount)) * 100) / 100
    : 0;

  const totalNicheVolume = enriched.reduce((sum, p) => sum + (p.totalSales || 0), 0);

  const nicheAnalytics = {
    avgPrice: prices.length > 0 ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : 0,
    minPrice: prices.length > 0 ? prices[0] : 0,
    maxPrice: prices.length > 0 ? prices[prices.length - 1] : 0,
    medianPrice: Math.round(medianPriceVal * 100) / 100,
    maxDiscountProduct,
    totalNicheVolume,
    competitionIndex,
    topRatedCount,
    lowRatedCount,
    totalAnalyzed: enriched.length
  };

  return { enrichedProducts: enriched, nicheAnalytics };
}

module.exports = { analyzeNiche, parsePrice, calcTrustScore, calcDiscountPct, calcRelevanceScore, filterByRelevance, extractNouns };
