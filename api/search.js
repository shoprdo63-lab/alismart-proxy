const { getIdsByImage, getProductDetails } = require('../services/aliexpress.js');

// Affiliate ID constant from environment or default
const AFFILIATE_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';

function extractImageUrl(query) {
  const raw = query.imgUrl || query.imageUrl || query.img || null;
  if (!raw) return null;
  let url = raw.trim();
  if (url.startsWith('//')) {
    url = 'https:' + url;
  }
  return url;
}

function applyCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
}

module.exports = async function handler(req, res) {
  // Log at very first line to debug what Vercel receives
  console.log('[API] Incoming req.query:', JSON.stringify(req.query));
  console.log('[API] Incoming req.url:', req.url);
  console.log('[API] Incoming req.method:', req.method);

  applyCORS(res);

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    applyCORS(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Permissive validation for debugging - accept q, imageUrl, or imgUrl
    const { q, imageUrl, imgUrl } = req.query;
    const image = imageUrl || imgUrl || q;

    if (!image) {
      console.error('[API] Missing parameters', req.query);
      applyCORS(res);
      return res.status(200).json({
        status: 'debug',
        message: 'No query or image provided',
        received: req.query
      });
    }

    console.log('[API Search] Fetching product IDs for image:', image);

    // Call the service function to get product IDs
    const productIds = await getIdsByImage(image);

    console.log('[API Search] Found', productIds.length, 'product IDs');

    if (productIds.length === 0) {
      return res.status(200).json({
        status: 'success',
        products: [],
        message: 'No matches found'
      });
    }

    // Fetch product details for the found product IDs
    console.log('[API Search] Fetching product details');
    const products = await getProductDetails(productIds);

    console.log('[API Search] Returning', products.length, 'products with details');

    // Enrich products with affiliate-ready URLs and standard field names
    const enrichedProducts = products.map(product => {
      const affiliateUrl = product.affiliateLink || product.productUrl || '';
      // Ensure affiliate ID is in the URL
      const finalUrl = affiliateUrl.includes('?') 
        ? `${affiliateUrl}&aff_id=${AFFILIATE_ID}` 
        : `${affiliateUrl}?aff_id=${AFFILIATE_ID}`;
      
      return {
        title: product.title || '',
        price: product.price || '',
        imageUrl: product.productImage || product.imageUrl || '',
        productUrl: finalUrl,
        rating: product.rating || null,
        productId: product.productId || ''
      };
    });

    return res.status(200).json({
      status: 'success',
      products: enrichedProducts,
      count: enrichedProducts.length
    });
  } catch (error) {
    console.error('[API Search] Error:', error.message);
    applyCORS(res);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch products',
      message: error.message
    });
  }
}
