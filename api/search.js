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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    applyCORS(res);
    return res.status(200).json({
      success: true,
      status: 'success',
      products: [],
      data: [],
      count: 0,
      message: 'OK'
    });
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    applyCORS(res);
    return res.status(405).json({
      success: false,
      status: 'error',
      message: 'Method not allowed',
      error: 'Only GET requests are supported'
    });
  }

  try {
    // Parameter extraction for image search
    let { q } = req.query;
    const image = req.query.imageUrl || req.query.imgUrl;

    // Treat "Aliexpress" as empty to prevent useless searches
    if (q === 'Aliexpress') {
      q = null;
    }

    // Validation: both q and image are missing
    if (!q && !image) {
      console.error('[API] Missing parameters', req.query);
      applyCORS(res);
      return res.status(400).json({
        success: false,
        status: 'error',
        products: [],
        data: [],
        error: 'Missing required parameters',
        message: "Please provide either 'q' for text search or 'imageUrl'/'imgUrl' for image search",
        received: req.query
      });
    }

    console.log('[API Search] Fetching product IDs for image:', image);

    // Call the service function to get product IDs
    const productIds = await getIdsByImage(image);

    console.log('[API Search] Found', productIds.length, 'product IDs');

    if (productIds.length === 0) {
      return res.status(200).json({
        success: true,
        status: 'success',
        products: [],
        data: [],
        count: 0,
        message: 'No products found'
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
      success: true,
      status: 'success',
      products: enrichedProducts,
      data: enrichedProducts,
      count: enrichedProducts.length,
      message: 'Products found successfully'
    });
  } catch (error) {
    console.error('[API Search] Error:', error.message);
    applyCORS(res);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: error.message,
      error: 'Failed to fetch products'
    });
  }
}
