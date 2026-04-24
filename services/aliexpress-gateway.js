/**
 * AliExpress Gateway Service
 * Official Affiliate API client with localization support
 * Features:
 * - Localization: language, currency, shipToCountry (target_country)
 * - User-Agent passthrough for human-like requests
 * - Clean normalized responses
 * - No image proxy - returns CDN URLs only
 */

const axios = require('axios');
const crypto = require('crypto');

const APP_KEY = process.env.ALI_APP_KEY || '528438';
const APP_SECRET = process.env.ALI_APP_SECRET || 'YPhzjbGESFs75SniEK0t1wwfKhvrKIhq';
const TRACKING_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const API_URL = 'https://api-sg.aliexpress.com/sync';

// Human-like User-Agent fallback
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Generate MD5 signature for AliExpress API
 */
function generateSign(params) {
  const sortedKeys = Object.keys(params).sort();
  const sortedParams = sortedKeys.map((key) => `${key}${params[key]}`).join('');
  const signString = APP_SECRET + sortedParams + APP_SECRET;
  return crypto.createHash('md5').update(signString).digest('hex').toUpperCase();
}

/**
 * Build API headers with User-Agent passthrough
 */
function buildHeaders(userAgent = '') {
  return {
    'Accept': 'application/json',
    'User-Agent': userAgent && userAgent.trim() ? userAgent.trim() : DEFAULT_USER_AGENT
  };
}

/**
 * Search products by keywords using AliExpress Affiliate API
 * @param {string} keywords - Search keywords
 * @param {Object} options - Search options
 * @param {string} options.language - Language code (e.g., 'en', 'he', 'es')
 * @param {string} options.currency - Currency code (e.g., 'USD', 'ILS', 'EUR')
 * @param {string} options.country - Ship to country code (e.g., 'US', 'IL', 'GB')
 * @param {string} options.userAgent - Client User-Agent
 * @param {number} options.pageSize - Number of results (max 50)
 * @returns {Promise<Object[]>} Array of normalized products
 */
async function searchByKeywords(keywords, options = {}) {
  if (!keywords || !keywords.trim()) {
    console.error('[Gateway] No keywords provided');
    return [];
  }

  const {
    language = 'en',
    currency = 'USD',
    country = 'US',
    userAgent = '',
    pageSize = 50
  } = options;

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const params = {
    method: 'aliexpress.affiliate.product.query',
    app_key: APP_KEY,
    timestamp,
    format: 'json',
    v: '2.0',
    sign_method: 'md5',
    fields: 'product_id,product_title,product_main_image_url,product_detail_url,sale_price,original_price,promotion_link,evaluate_rate,lastest_volume,discount,commission_rate,shop_url,shipping_cost,is_choice_item,target_original_price,target_sale_price',
    keywords: keywords.trim(),
    page_no: 1,
    page_size: Math.min(pageSize, 50),
    tracking_id: TRACKING_ID,
    // Localization parameters
    target_language: language.toLowerCase(),
    target_currency: currency.toUpperCase(),
    country: country.toUpperCase()
  };

  params.sign = generateSign(params);

  const queryString = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  try {
    console.log(`[Gateway] Keyword search: "${keywords}" (${language}/${currency}/${country})`);

    const response = await axios.get(`${API_URL}?${queryString}`, {
      headers: buildHeaders(userAgent),
      timeout: 15000
    });

    const data = response.data;
    const products = data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];

    console.log(`[Gateway] Retrieved ${products.length} products`);

    return products.map(normalizeProduct);
  } catch (error) {
    console.error('[Gateway] Keyword search error:', error.message);
    return [];
  }
}

/**
 * Get product details by IDs using AliExpress Affiliate API
 * @param {string[]} productIds - Array of product IDs
 * @param {Object} options - Options
 * @param {string} options.language - Language code
 * @param {string} options.currency - Currency code
 * @param {string} options.country - Ship to country code
 * @param {string} options.userAgent - Client User-Agent
 * @returns {Promise<Object[]>} Array of normalized products
 */
async function getProductDetails(productIds, options = {}) {
  if (!productIds || productIds.length === 0) {
    console.error('[Gateway] No product IDs provided');
    return [];
  }

  const {
    language = 'en',
    currency = 'USD',
    country = 'US',
    userAgent = ''
  } = options;

  // Limit to 20 products per request (API limit)
  const limitedIds = productIds.slice(0, 20);

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const params = {
    method: 'aliexpress.affiliate.product.detail.get',
    app_key: APP_KEY,
    timestamp,
    format: 'json',
    v: '2.0',
    sign_method: 'md5',
    fields: 'product_id,product_title,product_main_image_url,product_detail_url,sale_price,original_price,promotion_link,evaluate_rate,lastest_volume,discount,commission_rate,shop_url,shipping_cost,is_choice_item,target_original_price,target_sale_price',
    product_ids: limitedIds.join(','),
    tracking_id: TRACKING_ID,
    // Localization parameters
    target_language: language.toLowerCase(),
    target_currency: currency.toUpperCase(),
    country: country.toUpperCase()
  };

  params.sign = generateSign(params);

  const queryString = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  try {
    console.log(`[Gateway] Fetching ${limitedIds.length} products (${language}/${currency}/${country})`);

    const response = await axios.get(`${API_URL}?${queryString}`, {
      headers: buildHeaders(userAgent),
      timeout: 20000
    });

    const data = response.data;
    const products = data?.aliexpress_affiliate_product_detail_get_response?.resp_result?.result?.products?.product || [];

    console.log(`[Gateway] Retrieved ${products.length} product details`);

    return products.map(normalizeProduct);
  } catch (error) {
    console.error('[Gateway] Product details error:', error.message);
    return [];
  }
}

/**
 * Visual search via AliExpress
 * Uses official API or returns status for manual search on captcha
 * @param {string} imageUrl - Image URL to search
 * @param {Object} options - Options
 * @param {string} options.language - Language code
 * @param {string} options.currency - Currency code
 * @param {string} options.country - Ship to country code
 * @param {string} options.userAgent - Client User-Agent
 * @returns {Promise<Object>} { products: [], status: 'ok' | 'requires_manual_search' }
 */
async function getIdsByImage(imageUrl, options = {}) {
  if (!imageUrl || !imageUrl.trim()) {
    console.error('[Gateway] No image URL provided');
    return { products: [], status: 'error', message: 'No image URL' };
  }

  const {
    language = 'en',
    currency = 'USD',
    country = 'US',
    userAgent = ''
  } = options;

  console.log(`[Gateway] Visual search: ${imageUrl.substring(0, 60)}... (${language}/${currency}/${country})`);

  try {
    // Try official visual search API first
    // Note: AliExpress Affiliate API doesn't have a direct visual search endpoint
    // We use a hybrid approach: fetch from AliExpress visual search page
    // but with strict rules: no redirects, no image loading

    const result = await performVisualSearch(imageUrl, { language, currency, country, userAgent });
    
    return result;
  } catch (error) {
    console.error('[Gateway] Visual search error:', error.message);
    
    // Check if error indicates captcha/challenge
    if (error.response?.status === 403 || 
        error.message.includes('captcha') || 
        error.message.includes('challenge') ||
        error.message.includes('blocked')) {
      return {
        products: [],
        status: 'requires_manual_search',
        message: 'Visual search requires manual verification'
      };
    }
    
    return {
      products: [],
      status: 'error',
      message: error.message
    };
  }
}

/**
 * Perform visual search with bot-safe configuration
 * No redirects, no image loading - just extract product IDs
 */
async function performVisualSearch(imageUrl, options) {
  const { language, currency, country, userAgent } = options;
  
  // Determine domain based on language
  const domain = language === 'he' || language === 'iw' 
    ? 'he.aliexpress.com' 
    : 'www.aliexpress.com';

  // Build visual search URL
  const currencyCode = currency.toUpperCase();
  const searchUrl = `https://${domain}/glober/search/visual?imgUrl=${encodeURIComponent(imageUrl)}&currency=${currencyCode}`;

  // Build headers with User-Agent passthrough
  const headers = {
    'User-Agent': userAgent && userAgent.trim() ? userAgent.trim() : DEFAULT_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': `${language}-${country},${language};q=0.9,en-US;q=0.8`,
    'Accept-Charset': 'UTF-8',
    'Referer': `https://${domain}/`,
    'Origin': `https://${domain}`,
    'Cache-Control': 'max-age=0'
  };

  try {
    const response = await axios.get(searchUrl, {
      headers,
      timeout: 15000,
      maxRedirects: 0, // CRITICAL: Don't follow redirects - prevents bot detection
      responseType: 'text',
      validateStatus: (status) => status < 400 || status === 302 || status === 301
    });

    const html = response.data;

    // Check for captcha/challenge page
    if (html.includes('captcha') || 
        html.includes('verify') || 
        html.includes('challenge') ||
        html.includes('robot')) {
      console.log('[Gateway] Captcha/challenge detected in visual search');
      return {
        products: [],
        status: 'requires_manual_search',
        message: 'AliExpress requires manual verification'
      };
    }

    // Extract product IDs from HTML
    const productIdRegex = /"productId":"(\d+)"/g;
    const matches = [...html.matchAll(productIdRegex)];
    const productIds = [...new Set(matches.map(m => m[1]))];

    console.log(`[Gateway] Visual search found ${productIds.length} product IDs`);

    if (productIds.length === 0) {
      return {
        products: [],
        status: 'ok',
        message: 'No products found for this image'
      };
    }

    // Fetch product details via official API
    const products = await getProductDetails(productIds.slice(0, 20), {
      language,
      currency,
      country,
      userAgent
    });

    return {
      products,
      status: 'ok',
      totalFound: productIds.length
    };

  } catch (error) {
    // Handle 403/429 - return manual search status
    if (error.response?.status === 403 || error.response?.status === 429) {
      console.log('[Gateway] Blocked by AliExpress, returning manual search status');
      return {
        products: [],
        status: 'requires_manual_search',
        message: 'Search blocked - please try again later'
      };
    }
    
    throw error;
  }
}

/**
 * Normalize product from AliExpress API response
 * Returns clean, normalized product object
 */
function normalizeProduct(item) {
  if (!item) return null;

  const productId = String(item.product_id || item.id || '');
  
  // Use localized prices if available
  const price = item.target_sale_price || item.sale_price || item.price || '';
  const originalPrice = item.target_original_price || item.original_price || '';
  
  return {
    productId: productId,
    title: String(item.product_title || item.title || '').trim(),
    price: String(price),
    originalPrice: String(originalPrice),
    currency: item.target_currency || '',
    
    // Affiliate link (promotionUrl)
    affiliateLink: String(item.promotion_link || item.promotionLink || ''),
    
    // Direct product URL (fallback if no affiliate link)
    productUrl: String(item.product_detail_url || item.itemUrl || ''),
    
    // Image URL - client loads directly from CDN
    productImage: normalizeImageUrl(item.product_main_image_url || item.imageUrl || ''),
    
    // Ratings and sales
    rating: item.evaluate_rate ? parseFloat(item.evaluate_rate) : null,
    totalSales: item.lastest_volume ? parseInt(item.lastest_volume, 10) : 0,
    
    // Discount info
    discount: item.discount ? parseFloat(item.discount) : 0,
    commissionRate: item.commission_rate || '',
    
    // Store info
    storeName: String(item.store_name || item.storeName || ''),
    storeUrl: String(item.shop_url || item.storeUrl || ''),
    
    // Shipping
    shippingCost: item.shipping_cost || '0',
    
    // Choice item indicator
    isChoiceItem: item.is_choice_item === 'Y' || item.is_choice_item === true || false,
    
    // Additional metadata
    categoryId: item.category_id || ''
  };
}

/**
 * Normalize image URL
 * Removes tracking parameters, ensures HTTPS
 * Server does NOT load the image - just normalizes the URL
 */
function normalizeImageUrl(url) {
  if (!url) return '';
  
  let normalized = String(url);
  
  // Protocol-relative to HTTPS
  if (normalized.startsWith('//')) {
    normalized = 'https:' + normalized;
  }
  
  // HTTP to HTTPS
  if (normalized.startsWith('http://')) {
    normalized = normalized.replace('http://', 'https://');
  }
  
  // Remove tracking URLs entirely
  if (normalized.includes('s.click.aliexpress.com') || 
      normalized.includes('redirect') ||
      normalized.includes('clk.') ||
      normalized.includes('/go/')) {
    return '';
  }
  
  // Remove query parameters (often contain tracking)
  normalized = normalized.split('?')[0];
  
  // Remove resize suffixes
  normalized = normalized.replace(/_\d+x\d+\.jpg$/i, '.jpg');
  normalized = normalized.replace(/_\d+\.jpg$/i, '.jpg');
  
  return normalized;
}

module.exports = {
  searchByKeywords,
  getProductDetails,
  getIdsByImage
};
