const { getIdsByImage, getProductDetails } = require('../services/aliexpress.js');

module.exports = async function handler(req, res) {
  // CORS headers to allow requests from chrome extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const image = req.query.imageUrl || req.query.imgUrl;

    if (!image) {
      console.log('[API Search] Missing required parameters. Query params:', req.query);
      return res.status(400).json({ 
        error: 'imageUrl or imgUrl query parameter is required',
        receivedParams: Object.keys(req.query),
        hint: 'Please provide either ?imageUrl=... or ?imgUrl=... in your request'
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
