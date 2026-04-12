const { getIdsByImage, getProductDetails, searchByKeywords } = require('../services/aliexpress.js');

// Affiliate ID constant from environment or default
const AFFILIATE_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';

function applyCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

function enrichProducts(products) {
  return products.map(product => {
    const affiliateUrl = product.affiliateLink || product.productUrl || '';
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
}

async function callAliExpressAPI({ image, keywords }) {
  if (image) {
    const imageSearchResult = await getIdsByImage(image);
    const productIds = imageSearchResult.productIds || [];
    const searchDebug = imageSearchResult.debug;
    if (searchDebug) {
      console.log('[callAliExpressAPI] Visual search debug:', JSON.stringify(searchDebug));
    }
    if (productIds.length === 0) return [];
    return await getProductDetails(productIds);
  }
  if (keywords) {
    return await searchByKeywords(keywords);
  }
  return [];
}

module.exports = async function handler(req, res) {
  // Deploy timestamp: 2026-04-12-waterfall
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
    // 1. Smart parameter extraction
    let { q, productId, imageUrl, imgUrl } = req.query;

    // 2. Unify and clean image URL (critical!)
    let image = imageUrl || imgUrl;
    if (image) {
      image = image.trim();
      // Handle protocol-relative URLs
      if (image.startsWith('//')) image = 'https:' + image;
      // Remove size parameters that break search (e.g., _480x480.jpg_.avi)
      image = image.split('?')[0]; // Remove query params
      // Ensure proper extension
      const hasValidExt = image.match(/\.(jpg|jpeg|png|webp)([^a-z]|$)/i);
      if (!hasValidExt) {
        image += '.jpg';
      }
    }

    if (image) {
      const googleLensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(image)}`;
      console.log('[API Search] Google Lens URL prepared:', googleLensUrl);
    }

    // 3. Handle "Aliexpress" or "undefined" as empty
    if (q === 'Aliexpress' || q === 'undefined' || q === '') {
      q = null;
    }

    // Normalize image sentinel
    if (image === 'none') image = null;

    // Validation: both q and image are missing
    if (!q && !image) {
      console.error('[API] Missing search criteria', req.query);
      applyCORS(res);
      return res.status(400).json({
        success: false,
        error: 'Missing search criteria',
        message: 'Please provide q or imgUrl',
        received: req.query
      });
    }

    // ── Waterfall Search ──────────────────────────────────────────────────────

    // Step 1: Visual-First Search (if image exists)
    if (image) {
      console.log('[API Search] Step 1: Visual Search:', image);
      const visualResults = await callAliExpressAPI({ image, keywords: q });
      if (visualResults && visualResults.length > 0) {
        console.log('[API Search] Step 1 succeeded with', visualResults.length, 'results');
        const enriched = enrichProducts(visualResults);
        return res.status(200).json({
          success: true,
          status: 'success',
          products: enriched,
          data: enriched,
          count: enriched.length,
          message: 'Products found successfully'
        });
      }
      console.log('[API Search] Step 1 returned 0 results, falling through to keyword search');
    }

    // Step 2: Fallback to Keyword Search
    if (q) {
      console.log('[API Search] Step 2: Keyword Search:', q);
      const keywordResults = await callAliExpressAPI({ keywords: q });
      if (keywordResults && keywordResults.length > 0) {
        console.log('[API Search] Step 2 succeeded with', keywordResults.length, 'results');
        const enriched = enrichProducts(keywordResults);
        return res.status(200).json({
          success: true,
          status: 'success',
          products: enriched,
          data: enriched,
          count: enriched.length,
          message: 'Products found successfully'
        });
      }
      console.log('[API Search] Step 2 returned 0 results, falling through to broad search');

      // Step 3: Global Fallback — just the first word
      const broadQuery = q.split(' ')[0];
      console.log('[API Search] Step 3: Broad Search:', broadQuery);
      const broadResults = await callAliExpressAPI({ keywords: broadQuery });
      const enriched = enrichProducts(broadResults || []);
      return res.status(200).json({
        success: true,
        status: 'success',
        products: enriched,
        data: enriched,
        count: enriched.length,
        message: enriched.length > 0 ? 'Products found successfully' : 'No products found'
      });
    }

    // Image was provided but all visual steps failed — no keyword to fall back on
    return res.status(200).json({
      success: true,
      status: 'success',
      products: [],
      data: [],
      count: 0,
      message: 'No products found'
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
