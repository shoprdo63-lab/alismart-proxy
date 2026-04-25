/**
 * API Gateway - Smart Data Pipeline
 * Clean API interface to AliExpress Affiliate API
 * Features:
 * - No image proxy (client loads images directly from CDN)
 * - Localization: language, currency, shipToCountry support
 * - Redis caching for 5-10 minutes to prevent API flooding
 * - Human User-Agent passthrough
 * - Returns clean JSON: productId, title, price, promotionUrl
 */

const { searchByKeywords, getProductDetails, getIdsByImage } = require('../services/aliexpress-gateway.js');
const cache = require('../services/redis-cache.js');

/**
 * API Gateway Handler
 * POST /api/gateway-search
 * 
 * Body parameters:
 * - keywords: string (for text search)
 * - imageUrl: string (for visual search)
 * - productIds: string[] (for direct product lookup)
 * - language: string (e.g., 'en', 'he', 'es') - default: 'en'
 * - currency: string (e.g., 'USD', 'ILS', 'EUR') - default: 'USD'
 * - shipToCountry: string (e.g., 'US', 'IL', 'GB') - default: 'US'
 * - limit: number - default: 50
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const EXTENSION_ID = process.env.EXTENSION_ID || '';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  
  // בדיקת Origin מורשה
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || 
    (EXTENSION_ID && origin === `chrome-extension://${EXTENSION_ID}`) ||
    ALLOWED_ORIGINS.includes('*') ||
    origin.startsWith('chrome-extension://');
  
  // חייב לאפשר OPTIONS עבור ה-Preflight של הדפדפן
  if (req.method === 'OPTIONS') {
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Agent');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'חייב לשלוח ב-POST' });
  }
  
  // הוספת CORS לבקשה עצמה
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  const executionStart = Date.now();
  
  // Extract parameters from body
  const {
    keywords,
    imageUrl,
    productIds,
    language = 'en',
    currency = 'USD',
    shipToCountry = 'US',
    limit = 50
  } = req.body || {};

  // Extract client's User-Agent for human-like requests
  const clientUserAgent = req.headers['x-user-agent'] || req.headers['user-agent'] || '';

  // Validate search type
  const searchType = keywords ? 'keywords' : imageUrl ? 'visual' : productIds ? 'products' : null;
  
  if (!searchType) {
    return res.status(400).json({
      success: false,
      error: 'Missing search parameter. Provide keywords, imageUrl, or productIds'
    });
  }

  // Generate cache key based on search parameters and localization
  const cacheParams = { locale: language, currency, country: shipToCountry };
  const cacheKey = cache.generateCacheKey(
    searchType,
    keywords || imageUrl || productIds?.join(','),
    cacheParams
  );

  // Check cache first
  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[Gateway] Cache hit for ${searchType} search (${language}/${currency}/${shipToCountry})`);
      return res.status(200).json({
        ...cached,
        cached: true,
        executionTimeMs: Date.now() - executionStart
      });
    }
  } catch (cacheError) {
    console.error('[Gateway] Cache error:', cacheError.message);
  }

  // Localization options for API calls
  const localizationOptions = {
    language: language.toLowerCase(),
    currency: currency.toUpperCase(),
    country: shipToCountry.toUpperCase(),
    userAgent: clientUserAgent
  };

  console.log('\n🌐 ============================================');
  console.log(`🌐 API GATEWAY REQUEST`);
  console.log(`🌐 Type: ${searchType}`);
  console.log(`🌐 Language: ${language} | Currency: ${currency} | Ship to: ${shipToCountry}`);
  console.log(`🌐 User-Agent: ${clientUserAgent ? 'present' : 'default'}`);
  console.log('🌐 ============================================\n');

  try {
    let products = [];
    let searchMetadata = {};

    switch (searchType) {
      case 'keywords':
        const keywordResults = await searchByKeywords(keywords, {
          ...localizationOptions,
          pageSize: Math.min(parseInt(limit) || 50, 50)
        });
        products = keywordResults;
        searchMetadata = { keywords, totalResults: products.length };
        break;

      case 'visual':
        const visualResults = await getIdsByImage(imageUrl, localizationOptions);
        
        // Check if we got a captcha/challenge response
        if (visualResults.status === 'requires_manual_search') {
          return res.status(403).json({
            success: false,
            status: 'captcha_required',
            error: 'AliExpress דורש אימות ידני. נסה שוב מאוחר יותר.',
            products: [],
            executionTimeMs: Date.now() - executionStart
          });
        }
        
        products = visualResults.products || [];
        searchMetadata = { 
          imageUrl: imageUrl?.substring(0, 100), 
          totalResults: products.length 
        };
        break;

      case 'products':
        if (!Array.isArray(productIds) || productIds.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'productIds must be a non-empty array'
          });
        }
        const productResults = await getProductDetails(productIds.slice(0, 20), localizationOptions);
        products = productResults;
        searchMetadata = { requestedIds: productIds.length, found: products.length };
        break;
    }

    // Normalize products to clean JSON format
    // Server returns ONLY data - no image loading. Client handles images via CDN.
    const normalizedProducts = products.map(p => normalizeProduct(p));

    const totalTime = Date.now() - executionStart;

    console.log('\n✅ ============================================');
    console.log(`✅ GATEWAY SEARCH COMPLETE`);
    console.log(`✅ Results: ${normalizedProducts.length} products`);
    console.log(`✅ Time: ${Math.round(totalTime / 1000)}s`);
    console.log('✅ ============================================\n');

    const response = {
      success: true,
      products: normalizedProducts,
      count: normalizedProducts.length,
      localization: {
        language,
        currency,
        shipToCountry
      },
      search: searchMetadata,
      executionTimeMs: totalTime,
      cached: false
    };

    // Cache for 10 minutes (600 seconds) to prevent API flooding
    try {
      await cache.set(cacheKey, response, 600);
      console.log(`[Gateway] Cached results for ${searchType} (${language}/${currency}/${shipToCountry})`);
    } catch (cacheError) {
      console.error('[Gateway] Failed to cache:', cacheError.message);
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('[Gateway] Search error:', error);
    
    // בדיקת שגיאת קאפצ'ה מה-service
    if (error.code === 'CAPTCHA_REQUIRED' || error.status === 403) {
      return res.status(403).json({
        success: false,
        status: 'captcha_required',
        error: error.message || 'AliExpress דורש אימות ידני',
        localization: {
          language,
          currency,
          shipToCountry
        }
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message,
      localization: {
        language,
        currency,
        shipToCountry
      }
    });
  }
};

/**
 * Normalize product to clean API format
 * Returns only essential fields - no server-side image processing
 * @param {Object} p - Raw product from AliExpress API
 * @returns {Object} Clean normalized product
 */
function normalizeProduct(p) {
  const productId = String(p.productId || p.product_id || '');
  
  return {
    // Core fields (always present)
    productId: productId,
    title: String(p.title || p.product_title || '').substring(0, 200),
    price: String(p.price || p.sale_price || ''),
    currency: p.currency || '',
    
    // Affiliate link (promotionUrl)
    promotionUrl: String(p.affiliateLink || p.promotion_link || p.product_detail_url || ''),
    
    // Image URL - client loads directly from CDN, server doesn't proxy
    // We return the CDN URL pattern, not the actual image data
    imageUrl: normalizeImageUrl(p.productImage || p.product_main_image_url || p.imageUrl || ''),
    
    // Optional fields (may be null)
    originalPrice: String(p.originalPrice || p.original_price || ''),
    discount: p.discountPct || p.discount || null,
    rating: p.rating || p.evaluate_rate || null,
    orders: p.totalSales || p.lastest_volume || null,
    shipping: p.shippingCost || null,
    
    // Store info
    store: {
      name: String(p.storeName || p.store_name || ''),
      url: String(p.storeUrl || p.shop_url || '')
    },
    
    // AliExpress Choice indicator
    isChoice: p.isChoiceItem || p.is_choice_item || false
  };
}

/**
 * Normalize image URL - clean but don't load
 * Server doesn't proxy images - client loads directly from CDN
 * @param {string} url - Raw image URL
 * @returns {string} Clean CDN URL
 */
function normalizeImageUrl(url) {
  if (!url) return '';
  
  let normalized = String(url);
  
  // Handle protocol-relative URLs
  if (normalized.startsWith('//')) {
    normalized = 'https:' + normalized;
  }
  
  // Convert HTTP to HTTPS
  if (normalized.startsWith('http://')) {
    normalized = normalized.replace('http://', 'https://');
  }
  
  // STRIP tracking/redirect URLs - these cause bot detection
  // Server NEVER follows these redirects
  if (normalized.includes('s.click.aliexpress.com') || 
      normalized.includes('redirect') ||
      normalized.includes('clk.') ||
      normalized.includes('/go/') ||
      normalized.includes('affiliate')) {
    console.log(`[Image] Blocked tracking URL: ${normalized.substring(0, 50)}...`);
    return '';
  }
  
  // Remove query parameters (often contain tracking)
  normalized = normalized.split('?')[0];
  
  return normalized;
}
