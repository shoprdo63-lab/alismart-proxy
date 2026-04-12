const { getIdsByImage, getProductDetails, searchByKeywords } = require('../services/aliexpress.js');

// Affiliate ID constant from environment or default
const AFFILIATE_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';

function applyCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

/**
 * The Brain: Extract first N words from raw query for lean searching.
 * Simple split, no filtering - just first N words.
 */
function getFirstWords(rawQuery, n) {
  if (!rawQuery || typeof rawQuery !== 'string') return '';
  const words = rawQuery.trim().split(/\s+/).filter(w => w.length > 0);
  return words.slice(0, n).join(' ');
}

function enrichProducts(products) {
  return products.map(product => {
    const affiliateUrl = product.affiliateLink || product.productUrl || '';
    const finalUrl = affiliateUrl.includes('?')
      ? `${affiliateUrl}&aff_id=${AFFILIATE_ID}`
      : `${affiliateUrl}?aff_id=${AFFILIATE_ID}`;
    
    // Safety check: ensure imgUrl has protocol
    let imgUrl = product.productImage || product.imageUrl || '';
    if (imgUrl.startsWith('//')) {
      imgUrl = 'https:' + imgUrl;
    }
    
    return {
      title: product.title || '',
      price: product.price || '',
      imgUrl: imgUrl,  // MUST be imgUrl (not imageUrl or productImage)
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

    // ── The Brain: 3-Word Clean ────────────────────────────────────────────────
    const safeQuery3 = q ? getFirstWords(q, 3) : '';   // First 3 words only
    console.log('[API Search] Brain: Raw query:', q);
    console.log('[API Search] Brain: 3-word Safe Query:', safeQuery3);

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

    // ── 3-Step Waterfall Execution ─────────────────────────────────────────────
    let finalResults = [];

    // Step 1: imgUrl + 3 words
    if (image && safeQuery3) {
      console.log('[API Search] Step 1: img + 3 words:', safeQuery3);
      const step1Results = await callAliExpressAPI({ image, keywords: safeQuery3 });
      if (step1Results && step1Results.length >= 3) {
        console.log('[API Search] Step 1 succeeded with', step1Results.length, 'results (>=3)');
        finalResults = step1Results;
      } else {
        console.log('[API Search] Step 1 returned', step1Results?.length || 0, 'results (<3), continuing...');
      }
    }

    // Step 2: imgUrl only (if Step 1 returned < 3 results)
    if (finalResults.length === 0 && image) {
      console.log('[API Search] Step 2: img only');
      const step2Results = await callAliExpressAPI({ image, keywords: null });
      if (step2Results && step2Results.length >= 3) {
        console.log('[API Search] Step 2 succeeded with', step2Results.length, 'results (>=3)');
        finalResults = step2Results;
      } else {
        console.log('[API Search] Step 2 returned', step2Results?.length || 0, 'results (<3), continuing...');
      }
    }

    // Step 3: 3 words only (if image steps returned < 3 results or no image)
    if (finalResults.length === 0 && safeQuery3) {
      console.log('[API Search] Step 3: 3 words only:', safeQuery3);
      const step3Results = await callAliExpressAPI({ keywords: safeQuery3 });
      if (step3Results && step3Results.length > 0) {
        console.log('[API Search] Step 3 succeeded with', step3Results.length, 'results');
        finalResults = step3Results;
      }
    }

    // Result Aggregation: Sort by price (cheapest first) and enrich
    if (finalResults.length > 0) {
      // Parse price for sorting (remove $, commas, take numeric value)
      finalResults.sort((a, b) => {
        const priceA = parseFloat(a.price?.replace(/[^0-9.]/g, '')) || 0;
        const priceB = parseFloat(b.price?.replace(/[^0-9.]/g, '')) || 0;
        return priceA - priceB;
      });
      
      const enriched = enrichProducts(finalResults);
      return res.status(200).json({
        success: true,
        status: 'success',
        products: enriched,
        data: enriched,
        count: enriched.length,
        message: 'Products found successfully'
      });
    }

    // No results from any step
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
