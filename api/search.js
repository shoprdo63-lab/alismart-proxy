const { getIdsByImage, getProductDetails, searchByKeywords, searchByProductId } = require('../services/aliexpress.js');

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
 * "3 in 1 Chess Board Folding Wooden Portable..." → "Chess Board Wooden"
 */
function smartClean(query) {
  if (!query || typeof query !== 'string') return '';
  
  // Words to remove: adjectives + structure words
  const noiseWords = [
    // Adjectives
    'new', 'luxury', '2026', '2025', '2024', '2023', '2022', 'best', 'premium', 'high', 'quality',
    'original', 'genuine', 'authentic', 'official', 'deluxe', 'superior', 'excellent',
    'amazing', 'awesome', 'fantastic', 'wonderful', 'perfect', 'beautiful', 'elegant',
    'stylish', 'modern', 'latest', 'trendy', 'fashionable', 'popular', 'hot', 'top',
    'professional', 'pro', 'max', 'plus', 'advanced', 'enhanced', 'upgraded', 'improved',
    'special', 'limited', 'exclusive', 'sale', 'discount', 'cheap', 'free', 'hot sale',
    'large', 'small', 'big', 'tiny', 'mini', 'huge', 'compact', 'slim', 'thin', 'wide',
    'brand', 'used', 'refurbished', 'vintage', 'classic', 'retro',
    'very', 'really', 'super', 'ultra', 'mega', 'extra',
    // Structure/Function words
    'portable', 'folding', 'foldable', 'set', 'kit', 'pack', 'bundle', 'collection',
    '3 in 1', '2 in 1', '4 in 1', '5 in 1', 'multi', 'all in one',
    'for adults', 'for kids', 'for children', 'for women', 'for men', 'unisex',
    'with', 'and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'of'
  ];
  
  let cleaned = query.toLowerCase();
  
  // Remove noise words
  for (const word of noiseWords) {
    cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
  }
  
  // Remove numbers standing alone (like "3" in "3 in 1")
  cleaned = cleaned.replace(/\b\d+\b/g, ' ');
  
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
      title: String(product.title || '').substring(0, 200),
      price: String(product.price || ''),
      imgUrl: normalizeImageUrl(product.productImage || product.imageUrl || ''),
      productUrl: String(finalUrl || ''),
      rating: product.rating || null,
      productId: String(product.productId || '')
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
    // Extract parameters
    const q = req.query?.q || req.query?.query || req.query?.title || '';
    const searchMode = req.query?.searchMode || 'exact'; // 'exact' or 'visual'
    const rawProductId = req.query?.productId || '';
    const rawImgUrl = req.query?.imgUrl || req.query?.imageUrl || '';

    // Sanitize
    const productId = sanitizeProductId(rawProductId);
    const image = sanitizeImageUrl(rawImgUrl);
    const sourceCategory = detectCategory(q);

    console.log('[API] Mode:', searchMode, '| Category:', sourceCategory, '| PID:', productId || 'none', '| Img:', !!image);

    let results = [];

    // =====================================================
    // MODE: EXACT (find same product from other sellers)
    // =====================================================
    if (searchMode === 'exact') {
      // Priority 1: Product ID search
      if (productId) {
        try {
          console.log('[API] EXACT Priority 1: ProductId search');
          results = await searchByProductId(productId);
          console.log('[API] ProductId found:', results.length);
        } catch (e) {
          console.log('[API] ProductId failed:', e.message);
        }
      }

      // Priority 2: Cleaned text search
      if (results.length === 0 && q) {
        try {
          console.log('[API] EXACT Priority 2: Cleaned text search');
          const cleaned = smartClean(q);
          const safeQuery = smartTruncate(cleaned || q);
          console.log('[API] Cleaned:', q.substring(0, 40), '→', safeQuery);
          
          if (safeQuery) {
            results = await searchByKeywords(safeQuery);
          }
        } catch (e) {
          console.log('[API] Text search failed:', e.message);
        }
      }
    }

    // =====================================================
    // MODE: VISUAL (find visually similar products)
    // =====================================================
    else if (searchMode === 'visual') {
      // Priority 1: Visual search ONLY (ignores title)
      if (image) {
        try {
          console.log('[API] VISUAL Priority 1: Visual search');
          const imageResult = await getIdsByImage(image);
          if (imageResult?.productIds?.length > 0) {
            results = await getProductDetails(imageResult.productIds);
          }
          console.log('[API] Visual found:', results.length);
        } catch (e) {
          console.log('[API] Visual failed:', e.message);
        }
      }
    }

    // =====================================================
    // RANKING & SAFETY LAYER
    // =====================================================
    
    // Category filtering
    if (results.length > 0 && sourceCategory) {
      const beforeFilter = results.length;
      results = filterByCategory(results, sourceCategory);
      console.log('[API] Category filter:', beforeFilter, '→', results.length, '(', sourceCategory, ')');
    }

    // Enrich and return
    const enriched = enrichProducts(results);
    
    return res.status(200).json({
      success: true,
      products: enriched,
      data: enriched,
      count: enriched.length,
      mode: searchMode,
      category: sourceCategory
    });

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
