import { getIdsByImage } from '../services/aliexpress.js';

export default async function handler(req, res) {
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
    const { imageUrl } = req.query;

    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl query parameter is required' });
    }

    console.log('[API Search] Fetching product IDs for image:', imageUrl);

    // Call the service function to get product IDs
    const productIds = await getIdsByImage(imageUrl);

    console.log('[API Search] Found', productIds.length, 'product IDs');

    return res.status(200).json({
      success: true,
      productIds,
      count: productIds.length
    });
  } catch (error) {
    console.error('[API Search] Error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch product IDs',
      message: error.message
    });
  }
}
