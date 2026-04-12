const { getIdsByImage, getProductDetails, searchByKeywords, searchByProductId } = require('../services/aliexpress.js');

const AFFILIATE_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const MAX_QUERY_LENGTH = 100; // AliExpress API limit safety

function applyCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

/**
 * Smart Truncation: Limit query length to prevent API errors.
 */
function smartTruncate(text, maxLength = MAX_QUERY_LENGTH) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  // Truncate at last space before limit to avoid cutting words
  const truncated = trimmed.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
}

/**
 * Smart Clean: Strip common adjectives and marketing words from query.
 */
function smartClean(query) {
  if (!query || typeof query !== 'string') return '';
  
  const adjectives = [
    'new', 'luxury', '2026', '2025', '2024', '2023', '2022', 'best', 'premium', 'high', 'quality',
    'original', 'genuine', 'authentic', 'official', 'deluxe', 'superior', 'excellent',
    'amazing', 'awesome', 'fantastic', 'wonderful', 'perfect', 'beautiful', 'elegant',
    'stylish', 'modern', 'latest', 'trendy', 'fashionable', 'popular', 'hot', 'top',
    'large', 'small', 'big', 'tiny', 'mini', 'huge', 'compact', 'portable',
    'lightweight', 'heavy', 'slim', 'thin', 'wide', 'brand', 'used', 'refurbished',
    'vintage', 'classic', 'retro', 'very', 'really', 'super', 'ultra', 'mega',
    'extra', 'pro', 'max', 'plus', 'advanced', 'enhanced', 'upgraded', 'improved',
    'special', 'limited', 'exclusive', 'sale', 'discount', 'cheap', 'free'
  ];
  
  const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const cleaned = words.filter(word => !adjectives.includes(word) && word.length > 2);
  
  // If cleaning removed everything, fallback to first 3 words
  return cleaned.join(' ') || words.slice(0, 3).join(' ');
}

/**
 * Sanitize productId - remove non-numeric characters.
 */
function sanitizeProductId(id) {
  if (!id || typeof id !== 'string') return null;
  const cleaned = id.replace(/\D/g, ''); // Remove all non-digits
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Sanitize image URL - fix common issues.
 */
function sanitizeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let cleaned = url.trim();
  
  // Reject data URIs and blob URLs
  if (cleaned.startsWith('data:') || cleaned.startsWith('blob:')) return null;
  
  // Handle protocol-relative URLs
  if (cleaned.startsWith('//')) cleaned = 'https:' + cleaned;
  
  // Remove query params that often break image search
  cleaned = cleaned.split('?')[0];
  
  // Ensure valid image extension
  const hasValidExt = /\.(jpg|jpeg|png|webp|gif|bmp)([^a-z]|$)/i.test(cleaned);
  if (!hasValidExt) {
    // Try to fix common AliExpress image patterns
    if (cleaned.includes('aliexpress')) {
      cleaned = cleaned.replace(/_\d+x\d+\.jpg_.*$/, '.jpg');
    }
  }
  
  return cleaned;
}

function enrichProducts(products) {
  if (!Array.isArray(products)) return [];
  
  return products.map(product => {
    const affiliateUrl = product.affiliateLink || product.productUrl || '';
    const finalUrl = affiliateUrl.includes('?')
      ? `${affiliateUrl}&aff_id=${AFFILIATE_ID}`
      : `${affiliateUrl}?aff_id=${AFFILIATE_ID}`;
    
    let imgUrl = product.productImage || product.imageUrl || '';
    if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
    
    return {
      title: String(product.title || '').substring(0, 200),
      price: String(product.price || ''),
      imgUrl: String(imgUrl || ''),
      productUrl: String(finalUrl || ''),
      rating: product.rating || null,
      productId: String(product.productId || '')
    };
  });
}

module.exports = async function handler(req, res) {
  // Always set CORS first
  applyCORS(res);

  // Handle OPTIONS preflight - return empty success
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ success: true, products: [], count: 0 });
  }

  // Reject non-GET with empty success (never crash the extension)
  if (req.method !== 'GET') {
    return res.status(200).json({ success: true, products: [], count: 0 });
  }

  try {
    // Safely extract parameters with defaults
    const q = req.query?.q || req.query?.query || '';
    const rawProductId = req.query?.productId || '';
    const rawImgUrl = req.query?.imgUrl || req.query?.imageUrl || '';

    // Sanitize inputs
    const productId = sanitizeProductId(rawProductId);
    const image = sanitizeImageUrl(rawImgUrl);

    console.log('[API] Inputs:', { 
      productId: productId || 'none', 
      hasImage: !!image, 
      q: q ? 'present' : 'none' 
    });

    let results = [];

    // Priority 1: Product ID search (fetch Related Products)
    if (productId) {
      try {
        console.log('[API] Priority 1: ProductId search');
        results = await searchByProductId(productId);
        console.log('[API] ProductId result:', results.length, 'items');
      } catch (e) {
        console.log('[API] ProductId search failed:', e.message);
        results = [];
      }
    }

    // Priority 2: Visual search with imgUrl (if no results)
    if (results.length === 0 && image) {
      try {
        console.log('[API] Priority 2: Visual search');
        const imageResult = await getIdsByImage(image);
        if (imageResult?.productIds?.length > 0) {
          results = await getProductDetails(imageResult.productIds);
        }
        console.log('[API] Visual result:', results.length, 'items');
      } catch (e) {
        console.log('[API] Visual search failed:', e.message);
        results = [];
      }
    }

    // Priority 3: Keyword search with Smart Clean + Smart Truncate
    if (results.length === 0 && q) {
      try {
        console.log('[API] Priority 3: Keyword search');
        
        // Step 1: Clean the query
        const cleanedQuery = smartClean(q);
        console.log('[API] Smart Clean:', q.substring(0, 50), '->', cleanedQuery.substring(0, 50));
        
        // Step 2: Truncate to safe length
        const safeQuery = smartTruncate(cleanedQuery || q);
        
        if (safeQuery) {
          results = await searchByKeywords(safeQuery);
        }
        console.log('[API] Keyword result:', results.length, 'items');
      } catch (e) {
        console.log('[API] Keyword search failed:', e.message);
        results = [];
      }
    }

    // Return enriched results
    const enriched = enrichProducts(results);
    
    return res.status(200).json({
      success: true,
      products: enriched,
      data: enriched,
      count: enriched.length
    });

  } catch (error) {
    // Bulletproof: Never crash the extension
    console.error('[API] Critical error:', error?.message || 'Unknown error');
    return res.status(200).json({
      success: true,
      products: [],
      data: [],
      count: 0,
      error: 'Search failed silently'
    });
  }
};
