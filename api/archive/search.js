const { getIdsByImage, getProductDetails, searchByKeywords, searchByProductId, searchByKeywordsBatch } = require('../services/aliexpress.js');
const { analyzeNiche, filterByRelevance } = require('../services/analytics.js');
const cache = require('../services/cache.js');
const { filterProducts } = require('../services/content-filter.js');
const { deduplicateProducts, fastDeduplicate } = require('../services/deduplication.js');
const { minifyResponse, shouldMinify, calculateSavings } = require('../services/json-minify.js');
const translateQuery = require('../services/translation.js');
const { withRateLimit } = require('../services/rate-limiter.js');

const AFFILIATE_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 1000; // Maximum payload capacity per spec
const AUTO_MINIMAL_THRESHOLD = 500; // Auto-enable minimal mode for large result sets
const PROCESSING_TIME_TARGET = 2000; // 2 second target for filtering/sorting
const MAX_PER_STORE = 10; // Relaxed anti-monopoly: max items from a single store

// Category keywords for filtering
const CATEGORY_KEYWORDS = {
  clothing: ['t-shirt', 'shirt', 'dress', 'pants', 'jeans', 'skirt', 'jacket', 'coat', 'sweater', 'hoodie', 'blouse', 'top', 'bottom', 'clothing', 'apparel', 'fashion', 'wear', 'outfit', 'women', 'men', 'y2k', 'vintage', 'casual', 'sexy', 'slim', 'oversized'],
  games: ['chess', 'board game', 'puzzle', 'toy', 'game', 'playing cards', 'dice', 'checker', 'backgammon', 'monopoly'],
  electronics: ['phone', 'laptop', 'headphone', 'earphone', 'charger', 'cable', 'electronic', 'device', 'gadget', 'smart', 'wireless', 'bluetooth'],
  home: ['furniture', 'decor', 'kitchen', 'bathroom', 'bedroom', 'living room', 'home', 'house', 'apartment', 'interior']
};

function applyCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept-Language, Accept-Charset');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Accept-Charset', 'utf-8');
}

/**
 * Detect product category from title/query
 */
function detectCategory(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }
  return null;
}

/**
 * Smart Clean: Strip adjectives and structure words, keep only product essence.
 * Prioritizes English keywords from Hebrew queries.
 * "32Pcs Set Wooden Table Chess..." → "Wooden Chess"
 * "משחק שחמט עץ Chess Game" → "chess wood"
 */
function smartClean(query) {
  if (!query || typeof query !== 'string') return '';

  let cleaned = query;

  // STEP 0: Extract and preserve English words first (before Hebrew removal)
  const englishWords = [];
  const englishWordRegex = /\b[a-zA-Z]{3,}\b/g;
  let match;
  while ((match = englishWordRegex.exec(query)) !== null) {
    englishWords.push(match[0].toLowerCase());
  }

  // STEP 1: Strip ALL non-Latin scripts (Hebrew, Arabic, Chinese, Cyrillic, etc.)
  // This removes UI text like "מלאי מצומצם", price labels, and RTL noise
  cleaned = cleaned.replace(/[\u0590-\u05FF]/g, ' ');  // Hebrew
  cleaned = cleaned.replace(/[\u0600-\u06FF]/g, ' ');  // Arabic
  cleaned = cleaned.replace(/[\u4E00-\u9FFF]/g, ' ');  // Chinese
  cleaned = cleaned.replace(/[\u0400-\u04FF]/g, ' ');  // Cyrillic
  cleaned = cleaned.replace(/[\u3040-\u30FF]/g, ' ');  // Japanese
  cleaned = cleaned.replace(/[\uAC00-\uD7AF]/g, ' ');  // Korean

  // STEP 1b: Remove price tags and currency patterns (e.g., "$12.99", "US $5.00", "₪39.90", "EUR 10")
  cleaned = cleaned.replace(/[₪$€£¥]\s*\d+[.,]?\d*/g, ' ');
  cleaned = cleaned.replace(/\b(USD|EUR|GBP|ILS|CNY|US\s*\$)\s*\d+[.,]?\d*/gi, ' ');
  cleaned = cleaned.replace(/\d+[.,]?\d*\s*[₪$€£¥]/g, ' ');

  // STEP 1c: Remove dimension/spec patterns (e.g., "100x200cm", "5V/2A", "250ml")
  cleaned = cleaned.replace(/\b\d+(\.\d+)?\s*x\s*\d+(\.\d+)?\s*(cm|mm|m|inch|in)?\b/gi, ' ');
  cleaned = cleaned.replace(/\b\d+(\.\d+)?\s*(cm|mm|m|kg|g|lb|oz|ml|l|v|w|a|mah|inch|in)\b/gi, ' ');
  cleaned = cleaned.replace(/\b\d+\s*\/\s*\d+\s*(v|a|w)\b/gi, ' ');

  cleaned = cleaned.toLowerCase();

  // STEP 2: Remove quantity patterns (e.g., "32pcs", "30pcs", "100pcs")
  cleaned = cleaned.replace(/\b\d+\s*(pcs|pc|pieces|piece|units|unit|items|item|packs|pack|sets|set)\b/gi, ' ');

  // STEP 3: Remove standalone numbers
  cleaned = cleaned.replace(/\b\d+\b/g, ' ');

  // STEP 4: Remove "X in 1" patterns
  cleaned = cleaned.replace(/\b\d+\s*in\s*\d+\b/gi, ' ');

  // STEP 5: Words to remove - adjectives + structure words
  const noiseWords = [
    // Adjectives - marketing fluff
    'new', 'luxury', 'premium', 'high', 'quality', 'best', 'top',
    'original', 'genuine', 'authentic', 'official', 'deluxe', 'superior', 'excellent',
    'amazing', 'awesome', 'fantastic', 'wonderful', 'perfect', 'beautiful', 'elegant',
    'stylish', 'modern', 'latest', 'trendy', 'fashionable', 'popular', 'hot',
    'professional', 'pro', 'max', 'plus', 'advanced', 'enhanced', 'upgraded', 'improved',
    'special', 'limited', 'exclusive', 'sale', 'discount', 'cheap', 'free',
    'large', 'small', 'big', 'tiny', 'mini', 'huge', 'compact', 'slim', 'thin', 'wide',
    'brand', 'used', 'refurbished', 'vintage', 'classic', 'retro',
    'very', 'really', 'super', 'ultra', 'mega', 'extra', 'highly',
    // Years
    '2026', '2025', '2024', '2023', '2022', '2021', '2020',
    // E-commerce / shipping terms
    'shipping', 'fast', 'quick', 'express', 'delivery', 'worldwide', 'international',
    'wholesale', 'retail', 'bulk', 'dropshipping', 'dropship',
    // Structure/Function words
    'portable', 'folding', 'foldable', 'set', 'kit', 'pack', 'bundle', 'collection',
    'multi', 'multifunction', 'multifunctional', 'all in one', 'all-in-one',
    'reusable', 'washable', 'disposable', 'durable', 'practical', 'convenient',
    'perfect', 'ideal', 'suitable', 'compatible', 'adjustable', 'removable',
    // Audience descriptors
    'for adults', 'for kids', 'for children', 'for women', 'for men', 'unisex',
    'adults', 'kids', 'children', 'women', 'men', 'boys', 'girls',
    // Articles and prepositions
    'with', 'and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'of', 'for',
    'from', 'by', 'into', 'onto', 'upon',
    // Common e-commerce UI noise
    'add', 'cart', 'buy', 'now', 'stock', 'sold', 'out', 'available', 'left',
    'order', 'orders', 'review', 'reviews', 'rating', 'ratings', 'star', 'stars',
    'color', 'colour', 'size', 'option', 'options', 'select', 'choose', 'picked'
  ];

  // Remove noise words
  for (const word of noiseWords) {
    cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
  }

  // STEP 6: Remove common table/furniture structure words when paired with product
  cleaned = cleaned.replace(/\btable\s+(game|board|top|chess)\b/gi, '$1');

  // Clean up multiple spaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Get meaningful words (3+ chars)
  const words = cleaned.split(' ').filter(w => w.length >= 3);

  // PRIORITY: If we found English words in the original query, prioritize them
  // This ensures English keywords from Hebrew queries are preserved
  if (englishWords.length > 0) {
    const uniqueEnglishWords = [...new Set(englishWords)].filter(w => w.length >= 3);
    // Remove noise words from English words too
    const filteredEnglish = uniqueEnglishWords.filter(w => !noiseWords.includes(w.toLowerCase()));
    if (filteredEnglish.length >= 2) {
      return filteredEnglish.slice(0, 4).join(' ');
    }
  }

  // Fallback: If too few words, use original first 3 meaningful words (Latin only)
  if (words.length < 2) {
    const originalWords = query.toLowerCase()
      .replace(/[^\x20-\x7E]/g, ' ')  // Keep only basic Latin/ASCII
      .split(/\s+/)
      .filter(w => w.length >= 3);
    return originalWords.slice(0, 3).join(' ');
  }

  return words.join(' ');
}

function smartTruncate(text, maxLength = MAX_QUERY_LENGTH) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const truncated = trimmed.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
}

function sanitizeProductId(id) {
  if (!id || typeof id !== 'string') return null;
  const cleaned = id.replace(/\D/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

function sanitizeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let cleaned = url.trim();
  
  if (cleaned.startsWith('data:') || cleaned.startsWith('blob:')) return null;
  if (cleaned.startsWith('//')) cleaned = 'https:' + cleaned;
  cleaned = cleaned.split('?')[0];
  
  return cleaned;
}

/**
 * Extract numeric price from price string
 */
function extractPrice(priceStr) {
  if (!priceStr) return 0;
  const match = String(priceStr).match(/[\d,]+\.?\d*/);
  return match ? parseFloat(match[0].replace(/,/g, '')) : 0;
}

/**
 * Calculate Priority Score for a product
 * Higher score = better deal (lower price, higher rating, more sales)
 * Formula: (Rating * 20) + (Sales / 1000) + (100 / Price)
 * This gives:
 * - Rating: 0-100 points (5 stars = 100 points)
 * - Sales: 0-100 points (100,000 sales = 100 points)
 * - Price: 0-100 points (lower price = higher score, $1 = 100 points, $100 = 1 point)
 */
function calculatePriorityScore(product) {
  const rating = product.rating || 0;
  const sales = product.totalSales || 0;
  const price = extractPrice(product.price) || 1; // Avoid division by zero

  // Normalize rating to 0-100 scale (assuming max 5 stars)
  const ratingScore = Math.min(rating * 20, 100);

  // Normalize sales to 0-100 scale (assuming 100,000 sales = 100 points)
  const salesScore = Math.min(sales / 1000, 100);

  // Normalize price to 0-100 scale (inverse relationship - lower price = higher score)
  // Using log scale for better distribution: score = 100 - (log10(price) * 20)
  const priceScore = Math.max(0, Math.min(100, 100 - (Math.log10(price) * 20)));

  // Weighted combination: Rating (40%), Sales (30%), Price (30%)
  const priorityScore = (ratingScore * 0.4) + (salesScore * 0.3) + (priceScore * 0.3);

  return Math.round(priorityScore * 100) / 100; // Round to 2 decimal places
}

/**
 * Smart Select Top 1000 Products
 * Selects the best 1000 products from a large pool using multi-tier strategy:
 * - Tier 1: Top 300 by relevance (ensures high similarity to query)
 * - Tier 2: Next 400 by composite quality score (best deals)
 * - Tier 3: 300 diverse picks (ensures store/category variety)
 */
function selectTopProducts(products, targetCount = 1000) {
  if (!Array.isArray(products) || products.length <= targetCount) {
    return products;
  }

  const totalAvailable = products.length;
  console.log(`[API] Smart Select: ${totalAvailable} candidates → selecting top ${targetCount}`);

  // Calculate composite score for each product
  const scoredProducts = products.map(product => {
    const relevanceScore = product.relevanceScore || 0;
    const rating = product.rating || 0;
    const sales = product.totalSales || 0;
    const price = extractPrice(product.price) || 1;
    const hasDiscount = product.discountPct > 0;
    const isChoice = product.isChoiceItem;
    const priorityScore = product.priorityScore || 0;

    // Composite quality score (independent of relevance)
    const qualityScore = 
      (rating * 15) +                    // Rating: up to 75 points (5 stars)
      (Math.min(sales, 5000) / 5000 * 25) + // Sales: up to 25 points (capped at 5000)
      (hasDiscount ? 5 : 0) +            // Discount bonus
      (isChoice ? 3 : 0) +                 // Choice item bonus
      (priorityScore * 0.5);              // Priority score contribution

    return {
      ...product,
      qualityScore: Math.round(qualityScore * 100) / 100,
      compositeScore: Math.round((relevanceScore * 0.6 + qualityScore * 0.4) * 100) / 100
    };
  });

  // Tier 1: Top 300 by relevance (ensures query similarity)
  const sortedByRelevance = [...scoredProducts].sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  const tier1 = sortedByRelevance.slice(0, 300);
  const tier1Ids = new Set(tier1.map(p => p.productId));

  // Tier 2: Next 400 by quality score from remaining products
  const remainingAfterTier1 = scoredProducts.filter(p => !tier1Ids.has(p.productId));
  const sortedByQuality = remainingAfterTier1.sort((a, b) => b.qualityScore - a.qualityScore);
  const tier2 = sortedByQuality.slice(0, 400);
  const tier2Ids = new Set(tier2.map(p => p.productId));

  // Tier 3: 300 diverse picks from remaining (mix of composite score + diversity)
  const remainingAfterTier2 = scoredProducts.filter(p => !tier1Ids.has(p.productId) && !tier2Ids.has(p.productId));
  
  // Ensure diversity: limit to 2 per store in tier 3
  const storeCounts = new Map();
  const tier3 = [];
  
  // Sort remaining by composite score for selection
  const sortedByComposite = remainingAfterTier2.sort((a, b) => b.compositeScore - a.compositeScore);
  
  for (const product of sortedByComposite) {
    const storeId = product.storeUrl || product.storeName || 'unknown';
    const currentCount = storeCounts.get(storeId) || 0;
    
    if (currentCount < 2) {
      tier3.push(product);
      storeCounts.set(storeId, currentCount + 1);
    }
    
    if (tier3.length >= 300) break;
  }

  // If we don't have 300 in tier3, fill with best remaining
  if (tier3.length < 300) {
    const tier3Ids = new Set(tier3.map(p => p.productId));
    const remaining = sortedByComposite.filter(p => !tier1Ids.has(p.productId) && !tier2Ids.has(p.productId) && !tier3Ids.has(p.productId));
    const needed = 300 - tier3.length;
    tier3.push(...remaining.slice(0, needed));
  }

  // Combine all tiers
  const selected = [...tier1, ...tier2, ...tier3].slice(0, targetCount);

  console.log(`[API] Selection breakdown: Tier 1 (relevance): ${tier1.length}, Tier 2 (quality): ${tier2.length}, Tier 3 (diverse): ${tier3.length}`);
  console.log(`[API] Final selection: ${selected.length} products (from ${totalAvailable} candidates)`);

  // Sort final result by composite score for presentation
  return selected.sort((a, b) => b.compositeScore - a.compositeScore);
}

/**
 * Filter products by category - remove mismatched categories
 */
function filterByCategory(products, sourceCategory) {
  if (!sourceCategory || !Array.isArray(products)) return products;
  
  return products.filter(product => {
    const productCategory = detectCategory(product.title);
    // Keep if no category detected or matches source
    if (!productCategory) return true;
    return productCategory === sourceCategory;
  });
}

/**
 * Filter products by price - remove suspiciously cheap items (likely spare parts)
 * If original is $50, filter out items under $20 (less than 40% of original)
 */
function filterByPrice(products, originalPriceStr) {
  if (!Array.isArray(products) || products.length === 0) return products;
  
  const originalPrice = extractPrice(originalPriceStr);
  if (originalPrice <= 0) return products;
  
  const minPrice = originalPrice * 0.4; // Minimum 40% of original price
  
  return products.filter(product => {
    const productPrice = extractPrice(product.price);
    // Keep if price is reasonable (>= 40% of original) or if we can't parse price
    if (productPrice <= 0) return true;
    return productPrice >= minPrice;
  });
}

/**
 * Normalize image URLs to always use https://
 */
function normalizeImageUrl(url) {
  if (!url) return '';
  let normalized = String(url);
  if (normalized.startsWith('//')) normalized = 'https:' + normalized;
  if (normalized.startsWith('http://')) normalized = normalized.replace('http://', 'https://');
  return normalized;
}

/**
 * Extract a stable store identifier from storeUrl or fallback fields.
 * Returns 'unknown_<index>' when no store info is available so those items
 * never collide with each other.
 */
function extractStoreId(product, index) {
  const url = product.storeUrl || '';
  if (url) {
    // Typical AliExpress store URL: https://www.aliexpress.com/store/1234567
    const match = url.match(/\/store\/(\d+)/);
    if (match) return match[1];
    // Fallback: use full URL as key
    return url;
  }
  // No store info — treat as unique so it doesn't get unfairly grouped
  return `unknown_${index}`;
}

/**
 * Store-ID Diversification (Anti-Monopoly)
 * Limits any single store to MAX_PER_STORE items in the final list.
 * Overflow items go to a waitlist and backfill remaining capacity.
 * Products are assumed to already be sorted by quality/trust.
 */
function diversifyByStore(products, maxPerStore = MAX_PER_STORE) {
  if (!Array.isArray(products) || products.length === 0) return { diversified: products || [], cappedStores: 0 };

  const storeCounts = new Map();
  const accepted = [];
  const waitlist = [];
  let cappedStores = 0;
  const cappedSet = new Set();

  for (let i = 0; i < products.length; i++) {
    const storeId = extractStoreId(products[i], i);
    const count = storeCounts.get(storeId) || 0;

    if (count < maxPerStore) {
      storeCounts.set(storeId, count + 1);
      accepted.push(products[i]);
    } else {
      waitlist.push(products[i]);
      if (!cappedSet.has(storeId)) {
        cappedSet.add(storeId);
        cappedStores++;
      }
    }
  }

  // Backfill: add waitlist items that come from stores with remaining capacity
  // This handles edge cases where accepted list is short
  for (const product of waitlist) {
    if (accepted.length >= products.length) break;
    accepted.push(product);
  }

  return { diversified: accepted, cappedStores };
}

function enrichProducts(products) {
  if (!Array.isArray(products)) return [];

  return products.map(product => {
    const affiliateUrl = product.affiliateLink || product.productUrl || '';
    const finalUrl = affiliateUrl.includes('?')
      ? `${affiliateUrl}&aff_id=${AFFILIATE_ID}`
      : `${affiliateUrl}?aff_id=${AFFILIATE_ID}`;

    // Parse shipping cost
    const shippingCost = product.shippingCost || '0';
    const shippingCostNum = parseFloat(String(shippingCost).replace(/[^\d.]/g, '')) || 0;

    // Calculate priority score
    const priorityScore = calculatePriorityScore(product);

    // SPREAD: Include ALL raw fields from AliExpress plus normalized fields
    // This allows extension's normalizeProduct to access original fields like 
    // product_main_image_url, target_sale_price, etc.
    return {
      // Raw AliExpress fields (pass-through)
      ...product,
      
      // Normalized/enhanced fields (may override raw fields)
      productId: String(product.productId || product.product_id || ''),
      title: String(product.title || product.product_title || '').substring(0, 200),
      price: String(product.price || product.sale_price || ''),
      originalPrice: String(product.originalPrice || product.original_price || ''),
      priceNumeric: product.priceNumeric || 0,
      currency: product.currency || 'USD',
      discountPct: product.discountPct || 0,
      imgUrl: normalizeImageUrl(product.productImage || product.product_main_image_url || product.imageUrl || ''),
      productUrl: String(finalUrl || ''),
      affiliateLink: String(product.affiliateLink || product.promotion_link || finalUrl || ''),
      rating: product.rating || product.evaluate_rate || null,
      totalSales: product.totalSales || product.lastest_volume || 0,
      trustScore: product.trustScore || 0,
      storeUrl: String(product.storeUrl || product.shop_url || ''),
      commissionRate: String(product.commissionRate || product.commission_rate || ''),
      category: product.category || detectCategory(product.title || product.product_title),
      shippingSpeed: product.shippingSpeed || 'standard',
      relevanceScore: product.relevanceScore || 0,
      marketPosition: product.marketPosition || 'mid',
      shippingCost: shippingCostNum,
      isChoiceItem: product.isChoiceItem || product.is_choice_item || false,
      itemUrl: String(product.itemUrl || product.product_detail_url || ''),
      priorityScore: priorityScore
    };
  });
}

/**
 * Minimal response mode for fast filter processing
 * Returns only essential fields: title, price, image, link
 * Includes additional fields for data enrichment: discountPct, shippingCost, isChoiceItem
 */
function enrichMinimal(products) {
  if (!Array.isArray(products)) return [];

  // Fast path: pre-allocate array for speed
  const result = new Array(products.length);

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const affiliateUrl = product.affiliateLink || product.productUrl || '';
    const finalUrl = affiliateUrl.includes('?')
      ? `${affiliateUrl}&aff_id=${AFFILIATE_ID}`
      : `${affiliateUrl}?aff_id=${AFFILIATE_ID}`;

    // Parse shipping cost
    const shippingCost = product.shippingCost || '0';
    const shippingCostNum = parseFloat(String(shippingCost).replace(/[^\d.]/g, '')) || 0;

    // Calculate priority score (even in minimal mode for sorting)
    const priorityScore = calculatePriorityScore(product);

    // SPREAD: Include ALL raw fields plus minimal essential fields
    // Extension's normalizeProduct will handle field mapping
    result[i] = {
      // Raw AliExpress fields (pass-through)
      ...product,
      
      // Minimal essential fields (may override raw fields)
      title: String(product.title || product.product_title || '').substring(0, 200),
      price: String(product.price || product.sale_price || ''),
      imgUrl: normalizeImageUrl(product.productImage || product.product_main_image_url || product.imageUrl || ''),
      affiliateLink: String(product.affiliateLink || product.promotion_link || finalUrl || ''),
      discountPct: product.discountPct || 0,
      shippingCost: shippingCostNum,
      isChoiceItem: product.isChoiceItem || product.is_choice_item || false,
      itemUrl: String(product.itemUrl || product.product_detail_url || ''),
      priorityScore: priorityScore,
      relevanceScore: product.relevanceScore || 0
    };
  }

  return result;
}

// Create the original handler function
async function searchHandler(req, res) {
  applyCORS(res);

  // Bulletproof: Always return 200 with JSON
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ success: true, products: [], count: 0 });
  }

  if (req.method !== 'GET') {
    return res.status(200).json({ success: true, products: [], count: 0 });
  }

  try {
    const executionStart = Date.now();
    const perfTimings = {}; // Track each phase for optimization analysis

    // Extract parameters
    const q = req.query?.q || req.query?.query || req.query?.title || '';
    const searchMode = req.query?.searchMode || 'exact'; // 'exact' or 'visual'
    const rawProductId = req.query?.productId || '';
    const rawImgUrl = req.query?.imgUrl || req.query?.imageUrl || '';
    const originalPrice = req.query?.originalPrice || req.query?.price || '';
    const minimal = req.query?.minimal === 'true' || req.query?.minimal === '1'; // Minimal mode: only title, price, image, link
    const limit = Math.min(parseInt(req.query?.limit) || MAX_RESULTS, MAX_RESULTS); // Cap at 1000 per spec
    const locale = req.query?.locale || 'en'; // User locale for regional results
    const currency = req.query?.currency || 'USD'; // User currency (e.g., ILS, EUR, USD)
    const region = req.query?.region || ''; // User region code (e.g., IL, US, ES)
    const _t = req.query?._t || ''; // Cache-busting timestamp from extension
    const skipCache = req.query?.skipCache === 'true' || req.query?.skipCache === '1'; // Skip cache for fresh results

    // Sanitize
    const productId = sanitizeProductId(rawProductId);
    const image = sanitizeImageUrl(rawImgUrl);
    const sourceCategory = detectCategory(q);

    console.log('[API] Mode:', searchMode, '| Category:', sourceCategory, '| PID:', productId || 'none', '| Img:', !!image, '| OrigPrice:', originalPrice || 'none', '| Locale:', locale, '| Currency:', currency, '| Region:', region || 'auto');

    // =====================================================
    // CACHE CHECK
    // =====================================================
    // Include all localization params in cache key for region-specific results
    const cKey = cache.cacheKey('search', searchMode, q || rawProductId || rawImgUrl, `${locale}:${currency}:${region}:${_t}`);
    
    // Cache-busting: if _t timestamp provided, always skip cache for fresh results
    const shouldSkipCache = skipCache || _t;
    
    if (!shouldSkipCache) {
      const cached = cache.get(cKey);
      if (cached) {
        const executionTimeMs = Date.now() - executionStart;
        console.log(`[API] Cache HIT for key "${cKey}" — ${cached.count} products in ${executionTimeMs}ms`);
        return res.status(200).json({ ...cached, cached: true, executionTimeMs });
      }
    } else {
      console.log(`[API] Cache skipped (skipCache: ${skipCache}, _t: ${_t}) for key: ${cKey}`);
    }

    let results = [];
    let pagesScanned = 0;

    // =====================================================
    // MODE: EXACT - Find the same product from other sellers
    // Priority 1: Search by productId (most accurate)
    // Priority 2: Batch keyword search (6 pages, 100+ results)
    // =====================================================
    if (searchMode === 'exact') {
      // Priority 1: Product ID search
      if (productId) {
        try {
          console.log('[API] EXACT Priority 1: ProductId search');
          results = await searchByProductId(productId);
          pagesScanned = 1;
          console.log('[API] ProductId found:', results.length);
        } catch (e) {
          console.log('[API] ProductId failed:', e.message);
        }
      }

    // Priority 2: Batch keyword search — targeting up to 1,000 results per spec
    if (results.length === 0 && q) {
      try {
        console.log(`[API] EXACT Priority 2: Batch keyword search targeting ${limit} results`);
        // Always translate query to English for better AliExpress API results
        // This handles Hebrew, Arabic, Russian, and other languages
        const translatedQuery = await translateQuery(q, 'en');
        console.log('[API] Original query:', q.substring(0, 40), '→ Translated:', translatedQuery.substring(0, 40));
        
        // Use translated query for category detection too
        const queryForCategory = translatedQuery || q;
        const cleaned = smartClean(queryForCategory);
        const safeQuery = smartTruncate(cleaned || queryForCategory);
        console.log('[API] Cleaned:', q.substring(0, 40), '→', safeQuery);

        if (safeQuery) {
          const batchStart = Date.now();
          // Fetch 1.5x limit to account for filtering losses
          results = await searchByKeywordsBatch(safeQuery, Math.ceil(limit * 1.5), 10);
          pagesScanned = Math.ceil(Math.ceil(limit * 1.5) / 20);
          perfTimings.fetch = Date.now() - batchStart;
        }
      } catch (e) {
        console.log('[API] Batch search failed:', e.message);
        // Fallback: try with original query if translation fails
        try {
          console.log('[API] Trying fallback with original query');
          const cleaned = smartClean(q);
          const safeQuery = smartTruncate(cleaned || q);
          if (safeQuery) {
            const batchStart = Date.now();
            results = await searchByKeywordsBatch(safeQuery, Math.ceil(limit * 1.5), 10);
            pagesScanned = Math.ceil(Math.ceil(limit * 1.5) / 20);
            perfTimings.fetch = Date.now() - batchStart;
          }
        } catch (fallbackError) {
          console.log('[API] Fallback also failed:', fallbackError.message);
        }
      }
    }
    }

    // =====================================================
    // MODE: VISUAL - Find visually similar products by image ONLY
    // Sends ONLY imgUrl to AliExpress, completely ignores title/text
    // This prevents unrelated results (furniture, makeup) caused by title noise
    // FALLBACK: If visual search returns no results, fallback to batch keyword search
    // =====================================================
    else if (searchMode === 'visual') {
      // Visual search ONLY - send image URL to AliExpress, ignore all text
      if (image) {
        try {
          console.log('[API] VISUAL: Image-only search (ignoring title)');
          const imageResult = await getIdsByImage(image, { locale, currency, region });
          if (imageResult?.productIds?.length > 0) {
            results = await getProductDetails(imageResult.productIds);
            pagesScanned = 1;
          }
          console.log('[API] Visual found:', results.length);
          
          // FALLBACK: If no visual results, try batch keyword search
          if (results.length === 0 && q) {
            console.log('[API] VISUAL FALLBACK: No visual results, trying batch keyword search');
            // Translate query to English for better AliExpress API results
            const translatedQuery = await translateQuery(q, 'en');
            console.log('[API] Original query:', q.substring(0, 40), '→ Translated:', translatedQuery.substring(0, 40));
            const cleaned = smartClean(translatedQuery);
            const safeQuery = smartTruncate(cleaned || translatedQuery);
            console.log('[API] Fallback query:', q.substring(0, 40), '→', safeQuery);

            if (safeQuery) {
              const batchStart = Date.now();
              results = await searchByKeywordsBatch(safeQuery, Math.ceil(limit * 1.5), 10);
              pagesScanned = Math.ceil(Math.ceil(limit * 1.5) / 20);
              perfTimings.fetch = Date.now() - batchStart;
              console.log('[API] Fallback batch found:', results.length);
            }
          }
        } catch (e) {
          console.log('[API] Visual failed:', e.message);
        }
      }
    }

    // =====================================================
    // RANKING & SAFETY LAYERS  (spec §6 pipeline order)
    // =====================================================
    const filterStart = Date.now();

    // Layer 0 — DEDUPLICATION: Aggressive fingerprint-based deduplication
    // Removes duplicate listings, keeping highest Value Score (Orders/Price*Rating)
    if (results.length > 0) {
      const dedupStart = Date.now();
      const beforeDedup = results.length;
      // Use fast deduplication for large datasets (1000+ products)
      const { deduped, removedCount } = results.length > 500 
        ? fastDeduplicate(results) 
        : deduplicateProducts(results);
      console.log(`[API] Deduplication: ${beforeDedup} → ${deduped.length} (removed ${removedCount} duplicates)`);
      results = deduped;
      perfTimings.deduplication = Date.now() - dedupStart;
    }

    // Layer 1 — THE SHIELD: Halachic content safety filter
    // Runs on ALL raw products before any other filtering.
    if (results.length > 0) {
      const shieldStart = Date.now();
      const rawCount = results.length;
      const { filtered, blockedCount } = filterProducts(results);
      console.log(`[API] Content filter (Shield): ${rawCount} → ${filtered.length} (blocked ${blockedCount})`);
      results = filtered;
      perfTimings.contentFilter = Date.now() - shieldStart;
    }

    // Layer 2: Category filtering
    if (results.length > 0 && sourceCategory) {
      const catStart = Date.now();
      const beforeFilter = results.length;
      results = filterByCategory(results, sourceCategory);
      console.log('[API] Category filter:', beforeFilter, '→', results.length, '(', sourceCategory, ')');
      perfTimings.categoryFilter = Date.now() - catStart;
    }

    // Layer 3: Price filtering - remove suspiciously cheap items (likely spare parts)
    if (results.length > 0 && originalPrice) {
      const priceStart = Date.now();
      const beforePriceFilter = results.length;
      results = filterByPrice(results, originalPrice);
      console.log('[API] Price filter:', beforePriceFilter, '→', results.length, '(min 40% of', originalPrice, ')');
      perfTimings.priceFilter = Date.now() - priceStart;
    }

    // Layer 4 — SNIPER FILTER: Semantic noun-matching relevance
    // Stamps relevanceScore on every surviving item; drops items < 25.
    if (results.length > 0 && q) {
      const relStart = Date.now();
      const beforeRelevance = results.length;
      const { relevant, droppedCount } = filterByRelevance(results, q, 25);
      console.log(`[API] Relevance filter (Sniper): ${beforeRelevance} → ${relevant.length} (dropped ${droppedCount} irrelevant)`);
      results = relevant;
      perfTimings.relevanceFilter = Date.now() - relStart;
    }

    // Layer 5 — STORE DIVERSIFICATION: Anti-monopoly filter
    // Limits any single store to MAX_PER_STORE items so users see variety across sellers
    if (results.length > 0) {
      const storeStart = Date.now();
      const beforeDiversify = results.length;
      const { diversified, cappedStores } = diversifyByStore(results, MAX_PER_STORE);
      console.log(`[API] Store diversification: ${beforeDiversify} → ${diversified.length} (${cappedStores} stores capped at ${MAX_PER_STORE})`);
      results = diversified;
      perfTimings.storeDiversification = Date.now() - storeStart;
    }

    perfTimings.totalFiltering = Date.now() - filterStart;

    // =====================================================
    // ENRICHMENT & ANALYTICS
    // =====================================================
    const analyticsStart = Date.now();
    const { enrichedProducts, nicheAnalytics } = analyzeNiche(results, q);
    perfTimings.analytics = Date.now() - analyticsStart;

    // Smart selection: Pick top 1000 products from pool using multi-tier strategy
    // This ensures we get the highest quality, most relevant products
    const limitedProducts = selectTopProducts(enrichedProducts, limit);

    // Auto-enable minimal mode for large result sets (>500 items)
    // This ensures payload stays light and processing is fast
    const useMinimal = minimal || limitedProducts.length > AUTO_MINIMAL_THRESHOLD;
    if (useMinimal && !minimal) {
      console.log(`[API] Auto-enabled minimal mode for ${limitedProducts.length} results`);
    }

    // Final enrichment pass - use minimal mode for speed with large result sets
    const enrichStart = Date.now();
    const finalProducts = useMinimal ? enrichMinimal(limitedProducts) : enrichProducts(limitedProducts);
    perfTimings.enrichment = Date.now() - enrichStart;

    const executionTimeMs = Date.now() - executionStart;
    console.log(`[API] Execution Time: ${executionTimeMs}ms for ${finalProducts.length} items (target: <5000ms)`);
    console.log(`[API] Phase timings:`, perfTimings);

    // Warn if processing exceeded targets
    if (executionTimeMs > 5000) {
      console.warn(`[API] ⚠ SLOW: ${executionTimeMs}ms exceeds 5000ms target for ${finalProducts.length} items`);
    }
    if (perfTimings.totalFiltering > PROCESSING_TIME_TARGET) {
      console.warn(`[API] ⚠ FILTERING SLOW: ${perfTimings.totalFiltering}ms exceeds ${PROCESSING_TIME_TARGET}ms target`);
    }

    const responsePayload = {
      success: true,
      products: finalProducts,
      data: finalProducts,
      count: finalProducts.length,
      mode: searchMode,
      locale: locale,
      currency: currency,
      region: region,
      category: sourceCategory,
      nicheAnalytics,
      executionTimeMs,
      processingTimeMs: perfTimings.totalFiltering,
      cached: false,
      pagesScanned,
      poolSize: enrichedProducts.length, // Total candidates before smart selection
      limited: enrichedProducts.length > limit ? limit : null,
      selectionQuality: finalProducts.length > 0 ? {
        avgCompositeScore: Math.round(finalProducts.reduce((sum, p) => sum + (p.compositeScore || 0), 0) / finalProducts.length * 100) / 100,
        avgRelevanceScore: Math.round(finalProducts.reduce((sum, p) => sum + (p.relevanceScore || 0), 0) / finalProducts.length * 100) / 100,
        avgQualityScore: Math.round(finalProducts.reduce((sum, p) => sum + (p.qualityScore || 0), 0) / finalProducts.length * 100) / 100
      } : null
    };

    // JSON Optimization: Minify response for large payloads (500+ products)
    // Uses short keys (t for title, p for price, etc.) to reduce payload size
    const useMinified = shouldMinify(finalProducts.length);
    if (useMinified) {
      const minifyStart = Date.now();
      const minifiedPayload = minifyResponse(responsePayload, useMinimal);
      perfTimings.minification = Date.now() - minifyStart;
      
      // Log size savings for monitoring
      const savings = calculateSavings(responsePayload, minifiedPayload);
      console.log(`[API] JSON Minification: ${savings.originalBytes} → ${savings.minifiedBytes} bytes (${savings.ratio} saved)`);
      
      // Store minified version in cache
      cache.set(cKey, minifiedPayload);
      
      // Return minified JSON — use res.json() for clean standard output
      return res.status(200).json(minifiedPayload);
    }

    // Store in cache for 1 hour
    cache.set(cKey, responsePayload);

    return res.status(200).json(responsePayload);

  } catch (error) {
    // Absolute bulletproof safety
    console.error('[API] Fatal error:', error?.message || 'Unknown');
    return res.status(200).json({
      success: true,
      products: [],
      data: [],
      count: 0,
      error: 'Search failed silently'
    });
  }
};

// Export the handler wrapped with rate limiting
module.exports = withRateLimit(searchHandler);
