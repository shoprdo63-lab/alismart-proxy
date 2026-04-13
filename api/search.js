const { getIdsByImage, getProductDetails, searchByKeywords, searchByProductId, searchByKeywordsBatch } = require('../services/aliexpress.js');
const { analyzeNiche, filterByRelevance } = require('../services/analytics.js');
const cache = require('../services/cache.js');
const { filterProducts } = require('../services/content-filter.js');

const AFFILIATE_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const MAX_QUERY_LENGTH = 100;

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
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
 * "32Pcs Set Wooden Table Chess..." → "Wooden Chess"
 */
function smartClean(query) {
  if (!query || typeof query !== 'string') return '';

  let cleaned = query.toLowerCase();

  // STEP 1: Remove quantity patterns (e.g., "32pcs", "30pcs", "100pcs")
  cleaned = cleaned.replace(/\b\d+\s*(pcs|pc|pieces|piece|units|unit|items|item|packs|pack|sets|set)\b/gi, ' ');

  // STEP 2: Remove standalone numbers
  cleaned = cleaned.replace(/\b\d+\b/g, ' ');

  // STEP 3: Remove "X in 1" patterns
  cleaned = cleaned.replace(/\b\d+\s*in\s*\d+\b/gi, ' ');

  // STEP 4: Words to remove - adjectives + structure words
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
    'from', 'by', 'into', 'onto', 'upon'
  ];

  // Remove noise words
  for (const word of noiseWords) {
    cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
  }

  // STEP 5: Remove common table/furniture structure words when paired with product
  cleaned = cleaned.replace(/\btable\s+(game|board|top|chess)\b/gi, '$1');

  // Clean up multiple spaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Get meaningful words (3+ chars)
  const words = cleaned.split(' ').filter(w => w.length >= 3);

  // If too few words, fallback to original first 3 meaningful words
  if (words.length < 2) {
    const originalWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
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

function enrichProducts(products) {
  if (!Array.isArray(products)) return [];
  
  return products.map(product => {
    const affiliateUrl = product.affiliateLink || product.productUrl || '';
    const finalUrl = affiliateUrl.includes('?')
      ? `${affiliateUrl}&aff_id=${AFFILIATE_ID}`
      : `${affiliateUrl}?aff_id=${AFFILIATE_ID}`;
    
    return {
      productId: String(product.productId || ''),
      title: String(product.title || '').substring(0, 200),
      price: String(product.price || ''),
      originalPrice: String(product.originalPrice || ''),
      priceNumeric: product.priceNumeric || 0,
      currency: product.currency || 'USD',
      discountPct: product.discountPct || 0,
      imgUrl: normalizeImageUrl(product.productImage || product.imageUrl || ''),
      productUrl: String(finalUrl || ''),
      affiliateLink: String(product.affiliateLink || finalUrl || ''),
      rating: product.rating || null,
      totalSales: product.totalSales || 0,
      trustScore: product.trustScore || 0,
      storeUrl: String(product.storeUrl || ''),
      commissionRate: String(product.commissionRate || ''),
      category: product.category || detectCategory(product.title),
      shippingSpeed: product.shippingSpeed || 'standard',
      relevanceScore: product.relevanceScore || 0,
      marketPosition: product.marketPosition || 'mid'
    };
  });
}

module.exports = async function handler(req, res) {
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

    // Extract parameters
    const q = req.query?.q || req.query?.query || req.query?.title || '';
    const searchMode = req.query?.searchMode || 'exact'; // 'exact' or 'visual'
    const rawProductId = req.query?.productId || '';
    const rawImgUrl = req.query?.imgUrl || req.query?.imageUrl || '';
    const originalPrice = req.query?.originalPrice || req.query?.price || '';

    // Sanitize
    const productId = sanitizeProductId(rawProductId);
    const image = sanitizeImageUrl(rawImgUrl);
    const sourceCategory = detectCategory(q);

    console.log('[API] Mode:', searchMode, '| Category:', sourceCategory, '| PID:', productId || 'none', '| Img:', !!image, '| OrigPrice:', originalPrice || 'none');

    // =====================================================
    // CACHE CHECK
    // =====================================================
    const cKey = cache.cacheKey('search', searchMode, q || rawProductId || rawImgUrl);
    const cached = cache.get(cKey);
    if (cached) {
      const executionTimeMs = Date.now() - executionStart;
      console.log(`[API] Cache HIT for key "${cKey}" — ${cached.count} products in ${executionTimeMs}ms`);
      return res.status(200).json({ ...cached, cached: true, executionTimeMs });
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

      // Priority 2: Batch keyword search — 4 sorts × 20 pages for ~1,500 raw products
      if (results.length === 0 && q) {
        try {
          console.log('[API] EXACT Priority 2: Batch keyword search (80 pages, 4 sorts × 20 pages)');
          const cleaned = smartClean(q);
          const safeQuery = smartTruncate(cleaned || q);
          console.log('[API] Cleaned:', q.substring(0, 40), '→', safeQuery);
          
          if (safeQuery) {
            results = await searchByKeywordsBatch(safeQuery, 80, 5);
            pagesScanned = 80;
          }
        } catch (e) {
          console.log('[API] Batch search failed:', e.message);
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
          const imageResult = await getIdsByImage(image);
          if (imageResult?.productIds?.length > 0) {
            results = await getProductDetails(imageResult.productIds);
            pagesScanned = 1;
          }
          console.log('[API] Visual found:', results.length);
          
          // FALLBACK: If no visual results, try batch keyword search (50 pages)
          if (results.length === 0 && q) {
            console.log('[API] VISUAL FALLBACK: No visual results, trying batch keyword search');
            const cleaned = smartClean(q);
            const safeQuery = smartTruncate(cleaned || q);
            console.log('[API] Fallback query:', q.substring(0, 40), '→', safeQuery);
            
            if (safeQuery) {
              results = await searchByKeywordsBatch(safeQuery, 80, 5);
              pagesScanned = 80;
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

    // Layer 1 — THE SHIELD: Halachic content safety filter
    // Runs on ALL raw products before any other filtering.
    if (results.length > 0) {
      const rawCount = results.length;
      const { filtered, blockedCount } = filterProducts(results);
      console.log(`[API] Content filter (Shield): ${rawCount} → ${filtered.length} (blocked ${blockedCount})`);
      results = filtered;
    }

    // Layer 2: Category filtering
    if (results.length > 0 && sourceCategory) {
      const beforeFilter = results.length;
      results = filterByCategory(results, sourceCategory);
      console.log('[API] Category filter:', beforeFilter, '→', results.length, '(', sourceCategory, ')');
    }

    // Layer 3: Price filtering - remove suspiciously cheap items (likely spare parts)
    if (results.length > 0 && originalPrice) {
      const beforePriceFilter = results.length;
      results = filterByPrice(results, originalPrice);
      console.log('[API] Price filter:', beforePriceFilter, '→', results.length, '(min 40% of', originalPrice, ')');
    }

    // Layer 4 — SNIPER FILTER: Semantic noun-matching relevance
    // Stamps relevanceScore on every surviving item; drops items < 25.
    if (results.length > 0 && q) {
      const beforeRelevance = results.length;
      const { relevant, droppedCount } = filterByRelevance(results, q, 25);
      console.log(`[API] Relevance filter (Sniper): ${beforeRelevance} → ${relevant.length} (dropped ${droppedCount} irrelevant)`);
      results = relevant;
    }

    // =====================================================
    // ENRICHMENT & ANALYTICS
    // =====================================================
    const { enrichedProducts, nicheAnalytics } = analyzeNiche(results, q);

    // Final enrichment pass (affiliate links, image normalization, truncation)
    const finalProducts = enrichProducts(enrichedProducts);

    const executionTimeMs = Date.now() - executionStart;
    console.log(`[API] Execution Time: ${executionTimeMs}ms for ${finalProducts.length} items (target: <5000ms)`);
    if (executionTimeMs > 5000) {
      console.warn(`[API] ⚠ SLOW: ${executionTimeMs}ms exceeds 5000ms target for ${finalProducts.length} items`);
    }

    const responsePayload = {
      success: true,
      products: finalProducts,
      data: finalProducts,
      count: finalProducts.length,
      mode: searchMode,
      category: sourceCategory,
      nicheAnalytics,
      executionTimeMs,
      cached: false,
      pagesScanned
    };

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
