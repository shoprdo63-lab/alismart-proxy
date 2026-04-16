/**
 * JSON Minification Service
 * 
 * Optimizes JSON payloads for large-scale product responses (1,000+ items).
 * - Uses short single-letter keys (t, p, i, a)
 * - Strips whitespace for minimal payload size
 * - Selective field inclusion for minimal mode
 */

// Key mapping: Full key -> Minified key
const KEY_MAP = {
  // Product fields (minimal mode - 4 fields)
  title: 't',
  price: 'p',
  imgUrl: 'i',
  affiliateLink: 'a',
  
  // Extended fields (full mode)
  productId: 'id',
  originalPrice: 'op',
  priceNumeric: 'pn',
  currency: 'c',
  discountPct: 'd',
  itemUrl: 'u',
  rating: 'r',
  totalSales: 's',
  trustScore: 'ts',
  storeUrl: 'st',
  commissionRate: 'cr',
  category: 'cat',
  shippingSpeed: 'sh',
  relevanceScore: 'rs',
  marketPosition: 'mp',
  shippingCost: 'sc',
  isChoiceItem: 'ic',
  packageWeight: 'w',
  categoryId: 'cid',
  bundleId: 'bid',

  // Bundle fields
  bundles: 'bundles',
  bundleCount: 'bc',
  productsByStore: 'pbs',
  originalId: 'oid',
  alternativeId: 'aid',

  // Response envelope fields
  success: 'ok',
  products: 'data',
  count: 'n',
  mode: 'm',
  category: 'cat',
  nicheAnalytics: 'na',
  executionTimeMs: 'et',
  processingTimeMs: 'pt',
  cached: 'cache',
  pagesScanned: 'ps',
  limited: 'lim',
  error: 'err'
};

// Reverse mapping for reference
const REVERSE_KEY_MAP = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k])
);

/**
 * Minify a product object using short keys
 * @param {Object} product - Product with full key names
 * @param {boolean} minimal - If true, only include 4 core fields
 * @returns {Object} Product with minified keys
 */
function minifyProduct(product, minimal = false) {
  if (!product || typeof product !== 'object') return product;
  
  const minified = {};
  
  if (minimal) {
    // Minimal mode: Only 4 essential fields
    if (product.title !== undefined) minified[KEY_MAP.title] = product.title;
    if (product.price !== undefined) minified[KEY_MAP.price] = product.price;
    if (product.imgUrl !== undefined) minified[KEY_MAP.imgUrl] = product.imgUrl;
    if (product.affiliateLink !== undefined) minified[KEY_MAP.affiliateLink] = product.affiliateLink;
  } else {
    // Full mode: Map all available fields
    for (const [fullKey, value] of Object.entries(product)) {
      const shortKey = KEY_MAP[fullKey];
      if (shortKey) {
        minified[shortKey] = value;
      } else {
        // Keep unknown keys as-is
        minified[fullKey] = value;
      }
    }
  }
  
  return minified;
}

/**
 * Minify an array of products
 * @param {Object[]} products - Array of products
 * @param {boolean} minimal - Use minimal key set
 * @returns {Object[]} Array with minified products
 */
function minifyProducts(products, minimal = false) {
  if (!Array.isArray(products)) return products;
  return products.map(p => minifyProduct(p, minimal));
}

/**
 * Minify the complete API response envelope
 * @param {Object} response - Full response object
 * @param {boolean} minimalProducts - Whether to use minimal product fields
 * @returns {Object} Minified response
 */
function minifyResponse(response, minimalProducts = false) {
  if (!response || typeof response !== 'object') return response;
  
  const minified = {};
  
  for (const [key, value] of Object.entries(response)) {
    const shortKey = KEY_MAP[key] || key;
    
    if (key === 'products' || key === 'data') {
      // Minify the products array
      minified[shortKey] = minifyProducts(value, minimalProducts);
    } else if (key === 'nicheAnalytics' && value) {
      // Minify analytics object
      minified[shortKey] = minifyAnalytics(value);
    } else {
      minified[shortKey] = value;
    }
  }
  
  return minified;
}

/**
 * Minify niche analytics object
 * @param {Object} analytics - Niche analytics
 * @returns {Object} Minified analytics
 */
function minifyAnalytics(analytics) {
  if (!analytics || typeof analytics !== 'object') return analytics;
  
  return {
    ap: analytics.avgPrice,        // avgPrice
    mip: analytics.minPrice,     // minPrice
    map: analytics.maxPrice,     // maxPrice
    med: analytics.medianPrice,  // medianPrice
    mdp: analytics.maxDiscountProduct ? {
      id: analytics.maxDiscountProduct.productId,
      t: analytics.maxDiscountProduct.title,
      d: analytics.maxDiscountProduct.discountPct,
      p: analytics.maxDiscountProduct.price,
      op: analytics.maxDiscountProduct.originalPrice
    } : null,
    nv: analytics.totalNicheVolume,    // totalNicheVolume
    ci: analytics.competitionIndex,    // competitionIndex
    tr: analytics.topRatedCount,       // topRatedCount
    lr: analytics.lowRatedCount,       // lowRatedCount
    ta: analytics.totalAnalyzed        // totalAnalyzed
  };
}

/**
 * Create a compact JSON string with no whitespace
 * @param {Object} data - Data to stringify
 * @returns {string} Minified JSON
 */
function toCompactJSON(data) {
  return JSON.stringify(data);
}

/**
 * Calculate payload size reduction from minification
 * @param {Object} original - Original response
 * @param {Object} minified - Minified response
 * @returns {{originalBytes: number, minifiedBytes: number, savings: number, ratio: string}}
 */
function calculateSavings(original, minified) {
  const originalStr = JSON.stringify(original);
  const minifiedStr = JSON.stringify(minified);
  
  const originalBytes = Buffer.byteLength(originalStr, 'utf8');
  const minifiedBytes = Buffer.byteLength(minifiedStr, 'utf8');
  const savings = originalBytes - minifiedBytes;
  const ratio = ((savings / originalBytes) * 100).toFixed(1);
  
  return {
    originalBytes,
    minifiedBytes,
    savings,
    ratio: `${ratio}%`
  };
}

/**
 * Auto-detect if minification should be used based on payload size
 * @param {number} productCount - Number of products
 * @returns {boolean}
 */
function shouldMinify(productCount) {
  // Auto-minify for large payloads (500+ products)
  return productCount >= 500;
}

module.exports = {
  minifyProduct,
  minifyProducts,
  minifyResponse,
  minifyAnalytics,
  toCompactJSON,
  calculateSavings,
  shouldMinify,
  KEY_MAP,
  REVERSE_KEY_MAP
};
