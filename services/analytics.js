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
 * OPTIMIZED for speed: Consolidates multiple array passes into single-pass operations
 * to handle 1,000+ items in under 2 seconds.
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

  const count = products.length;

  // Single-pass: Pre-compute values and collect stats
  const enriched = new Array(count);
  const prices = [];
  let maxSales = 1;
  let topRatedCount = 0;
  let lowRatedCount = 0;
  let totalNicheVolume = 0;
  let maxDiscount = 0;
  let maxDiscountProduct = null;

  for (let i = 0; i < count; i++) {
    const p = products[i];
    const priceNumeric = parsePrice(p.price);
    const discountPct = calcDiscountPct(p.price, p.originalPrice);

    // Track max sales for normalization
    const sales = p.totalSales || 0;
    if (sales > maxSales) maxSales = sales;

    // Track price for stats
    if (priceNumeric > 0) prices.push(priceNumeric);

    // Track ratings for competition index
    const rating = p.rating;
    if (typeof rating === 'number') {
      if (rating >= 4.5) topRatedCount++;
      else if (rating > 0 && rating < 4.0) lowRatedCount++;
    }

    totalNicheVolume += sales;

    // Track max discount product
    if (discountPct > maxDiscount) {
      maxDiscount = discountPct;
      maxDiscountProduct = {
        productId: p.productId,
        title: p.title,
        discountPct,
        price: p.price,
        originalPrice: p.originalPrice
      };
    }

    // Pre-compute relevance score if query provided
    let relevanceScore = p.relevanceScore;
    if (query && typeof relevanceScore === 'undefined') {
      relevanceScore = calcRelevanceScore(query, p.title);
    }

    enriched[i] = {
      ...p,
      priceNumeric,
      discountPct,
      relevanceScore
    };
  }

  // Calculate price stats
  prices.sort((a, b) => a - b);
  const medianPriceVal = median(prices);
  const minPrice = prices.length > 0 ? prices[0] : 0;
  const maxPrice = prices.length > 0 ? prices[prices.length - 1] : 0;
  const avgPrice = prices.length > 0
    ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100
    : 0;

  // Single-pass: Compute trust scores
  for (let i = 0; i < count; i++) {
    enriched[i].trustScore = calcTrustScore(enriched[i], maxSales, medianPriceVal);
  }

  // Market position: Sort by trust score once (O(n log n)) and assign ranks
  // Create array of indices sorted by trust score descending
  const indices = new Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  indices.sort((a, b) => enriched[b].trustScore - enriched[a].trustScore);

  // Assign market position based on rank
  for (let rank = 0; rank < count; rank++) {
    enriched[indices[rank]].marketPosition = marketPosition(rank, count);
  }

  // Competition index
  const competitionIndex = (topRatedCount + lowRatedCount) > 0
    ? Math.round((topRatedCount / (topRatedCount + lowRatedCount)) * 100) / 100
    : 0;

  const nicheAnalytics = {
    avgPrice,
    minPrice,
    maxPrice,
    medianPrice: Math.round(medianPriceVal * 100) / 100,
    maxDiscountProduct,
    totalNicheVolume,
    competitionIndex,
    topRatedCount,
    lowRatedCount,
    totalAnalyzed: count
  };

  return { enrichedProducts: enriched, nicheAnalytics };
}

module.exports = { analyzeNiche, parsePrice, calcTrustScore, calcDiscountPct, calcRelevanceScore, filterByRelevance, extractNouns };
