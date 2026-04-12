const { getIdsByImage, getProductDetails } = require('../services/aliexpress.js');

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
  console.log('[API Search] Incoming request:', req.method, req.url, 'Query:', JSON.stringify(req.query));

  applyCORS(res);

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const image = extractImageUrl(req.query);

    if (!image) {
      console.log('[API Search] Missing required parameters. Query:', JSON.stringify(req.query));
      return res.status(400).json({
        error: 'Missing Parameters',
        received: req.query,
        expected: ['q', 'imgUrl']
      });
    }

    console.log('[API Search] Fetching product IDs for image:', image);

    // Call the service function to get product IDs
    const productIds = await getIdsByImage(image);

    console.log('[API Search] Found', productIds.length, 'product IDs');

    if (productIds.length === 0) {
      return res.status(200).json({
        success: true,
        products: [],
        count: 0
      });
    }

    // Fetch product details for the found product IDs
    console.log('[API Search] Fetching product details');
    const products = await getProductDetails(productIds);

    console.log('[API Search] Returning', products.length, 'products with details');

    return res.status(200).json({
      success: true,
      products,
      count: products.length
    });
  } catch (error) {
    console.error('[API Search] Error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch products',
      message: error.message
    });
  }
}
