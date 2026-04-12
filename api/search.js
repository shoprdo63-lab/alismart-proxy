const { getIdsByImage, getProductDetails, searchByKeywords, searchByProductId } = require('../services/aliexpress.js');

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

/**
 * Deep Search: Strip all adjectives from query, keeping only nouns and core product terms.
 * This helps find cheaper alternatives by removing descriptive words.
 */
function stripAdjectives(query) {
  if (!query || typeof query !== 'string') return '';
  
  // Common adjectives and descriptive words to remove
  const adjectives = [
    // Quality descriptors
    'best', 'premium', 'high', 'quality', 'original', 'genuine', 'authentic', 'official',
    'luxury', 'deluxe', 'superior', 'excellent', 'amazing', 'awesome', 'fantastic',
    'wonderful', 'perfect', 'beautiful', 'elegant', 'stylish', 'modern', 'new',
    'latest', 'trendy', 'fashionable', 'popular', 'hot', 'top', 'best-selling',
    // Size descriptors
    'large', 'small', 'big', 'tiny', 'mini', 'huge', 'massive', 'compact',
    'portable', 'lightweight', 'heavy', 'slim', 'thin', 'thick', 'wide', 'narrow',
    // Color/appearance (standalone words, not when part of product name)
    'colorful', 'bright', 'dark', 'light', 'shiny', 'matte', 'glossy', 'smooth',
    // Condition descriptors
    'brand', 'new', 'used', 'refurbished', 'vintage', 'classic', 'retro',
    // Generic intensifiers
    'very', 'really', 'super', 'ultra', 'mega', 'extra', 'pro', 'max', 'plus',
    'advanced', 'enhanced', 'upgraded', 'improved', 'special', 'limited', 'exclusive'
  ];
  
  const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const filteredWords = words.filter(word => !adjectives.includes(word) && word.length > 2);
  
  return filteredWords.join(' ') || words.slice(0, 3).join(' '); // Fallback to first 3 words
}

function parsePrice(priceStr) {
  if (!priceStr) return 0;
  // Extract numeric value from price string (handles $, EUR, etc.)
  const match = priceStr.toString().match(/[\d,]+\.?\d*/);
  return match ? parseFloat(match[0].replace(/,/g, '')) : 0;
}

function calculateTotalPrice(product) {
  const price = parsePrice(product.price);
  const shipping = parsePrice(product.shippingPrice || product.shipping || '0');
  return price + shipping;
}

function enrichProducts(products, referencePrice = null) {
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
    
    // Calculate total price (price + shipping)
    const totalPrice = calculateTotalPrice(product);
    const priceValue = parsePrice(product.price);
    const shippingValue = totalPrice - priceValue;
    
    return {
      title: product.title || '',
      price: product.price || '',
      shippingPrice: shippingValue > 0 ? `$${shippingValue.toFixed(2)}` : '',
      totalPrice: totalPrice > 0 ? `$${totalPrice.toFixed(2)}` : product.price || '',
      totalPriceValue: totalPrice, // Numeric for sorting
      imgUrl: imgUrl,  // MUST be imgUrl (not imageUrl or productImage)
      productUrl: finalUrl,
      rating: product.rating || null,
      productId: product.productId || ''
    };
  });
}

/**
 * Check if first 5 results are all above the reference price.
 * Returns true if deep search should be triggered.
 */
function shouldTriggerDeepSearch(results, referencePrice) {
  if (!referencePrice || results.length === 0) return false;
  
  const refPrice = parsePrice(referencePrice);
  if (refPrice <= 0) return false;
  
  const firstFive = results.slice(0, 5);
  if (firstFive.length < 3) return false; // Need at least some results to compare
  
  const allAboveReference = firstFive.every(product => {
    const totalPrice = parsePrice(product.totalPrice || product.price);
    return totalPrice >= refPrice * 0.95; // 5% tolerance for floating point / currency differences
  });
  
  return allAboveReference;
}

async function callAliExpressAPI({ productId, image, keywords }) {
  // Primary: Product ID search (most direct match)
  if (productId) {
    console.log('[callAliExpressAPI] Primary: Searching by productId:', productId);
    const results = await searchByProductId(productId);
    if (results && results.length > 0) {
      console.log('[callAliExpressAPI] ProductId search found', results.length, 'results');
      return results;
    }
    console.log('[callAliExpressAPI] ProductId search returned no results, continuing...');
  }
  
  // Fallback: Image search
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
  
  // Fallback: Keywords search
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
    let { q, productId, imageUrl, imgUrl, originalPrice } = req.query;

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

    // Parse original product price for comparison (if provided)
    const refPrice = originalPrice ? parsePrice(originalPrice) : 0;
    console.log('[API Search] Original product price for comparison:', refPrice);

    // ── 4-Step Waterfall Execution ─────────────────────────────────────────────
    let finalResults = [];
    let deepSearchTriggered = false;

    // Step 0: Product ID search (PRIMARY - most direct and accurate)
    if (productId) {
      console.log('[API Search] Step 0: Product ID search:', productId);
      const step0Results = await callAliExpressAPI({ productId });
      if (step0Results && step0Results.length >= 1) {
        console.log('[API Search] Step 0 succeeded with', step0Results.length, 'results');
        finalResults = step0Results;
      } else {
        console.log('[API Search] Step 0 returned', step0Results?.length || 0, 'results, continuing...');
      }
    }

    // Step 1: imgUrl + 3 words (if no productId or Step 0 returned < 1 result)
    if (finalResults.length === 0 && image && safeQuery3) {
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

    // Result Aggregation: Sort by total price (cheapest first) and enrich
    if (finalResults.length > 0) {
      // Parse total price for sorting (includes shipping)
      finalResults.sort((a, b) => {
        const totalA = calculateTotalPrice(a);
        const totalB = calculateTotalPrice(b);
        return totalA - totalB;
      });
      
      // Check if deep search should be triggered (first 5 results above original price)
      if (refPrice > 0 && shouldTriggerDeepSearch(finalResults, originalPrice) && safeQuery3) {
        console.log('[API Search] Deep Search Triggered: First 5 results above original price (' + originalPrice + ')');
        deepSearchTriggered = true;
        
        const strippedQuery = stripAdjectives(q || '');
        if (strippedQuery && strippedQuery !== safeQuery3) {
          console.log('[API Search] Deep Search: Stripped query from "' + safeQuery3 + '" to "' + strippedQuery + '"');
          const deepResults = await callAliExpressAPI({ keywords: strippedQuery });
          
          if (deepResults && deepResults.length > 0) {
            // Merge and re-sort results (keep unique by productId)
            const existingIds = new Set(finalResults.map(p => p.productId));
            const newDeepResults = deepResults.filter(p => !existingIds.has(p.productId));
            
            if (newDeepResults.length > 0) {
              console.log('[API Search] Deep Search found', newDeepResults.length, 'new products');
              finalResults = [...finalResults, ...newDeepResults];
              // Re-sort after merging
              finalResults.sort((a, b) => calculateTotalPrice(a) - calculateTotalPrice(b));
            }
          }
        }
      }
      
      const enriched = enrichProducts(finalResults, originalPrice);
      return res.status(200).json({
        success: true,
        status: 'success',
        products: enriched,
        data: enriched,
        count: enriched.length,
        deepSearchTriggered,
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
