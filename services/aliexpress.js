const axios = require('axios');
const crypto = require('crypto');

const APP_KEY = process.env.ALI_APP_KEY || '528438';
const APP_SECRET = process.env.ALI_APP_SECRET || 'YPhzjbGESFs75SniEK0t1wwfKhvrKIhq';
const TRACKING_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const API_URL = 'https://api-sg.aliexpress.com/sync';

/**
 * AliExpress domain mapping by locale
 * Supports ALL global marketplaces dynamically
 */
const ALIEXPRESS_DOMAINS = {
  // Major markets (explicit mapping for clarity)
  'en': 'www.aliexpress.com',      // English/Global
  'es': 'es.aliexpress.com',       // Spanish
  'fr': 'fr.aliexpress.com',       // French
  'de': 'de.aliexpress.com',       // German
  'it': 'it.aliexpress.com',       // Italian
  'pl': 'pl.aliexpress.com',       // Polish
  'nl': 'nl.aliexpress.com',       // Dutch
  'pt': 'pt.aliexpress.com',       // Portuguese
  'ru': 'ru.aliexpress.com',       // Russian
  'he': 'he.aliexpress.com',       // Hebrew
  'iw': 'he.aliexpress.com',       // Legacy Hebrew
  'ar': 'ar.aliexpress.com',       // Arabic
  'tr': 'tr.aliexpress.com',       // Turkish
  'ja': 'ja.aliexpress.com',       // Japanese
  'ko': 'ko.aliexpress.com',       // Korean
  'th': 'th.aliexpress.com',       // Thai
  'id': 'id.aliexpress.com',       // Indonesian
  'vi': 'vi.aliexpress.com',       // Vietnamese
  'ms': 'ms.aliexpress.com',       // Malay
  'zh': 'www.aliexpress.com',      // Chinese -> Global
};

/**
 * Valid locale codes pattern (2-3 letters)
 * AliExpress supports: ar, de, en, es, fr, he, id, it, ja, ko, ms, nl, pl, pt, ru, th, tr, vi, zh
 */
const LOCALE_PATTERN = /^[a-z]{2,3}$/;

/**
 * Get AliExpress domain for a locale
 * Works with ANY valid locale code dynamically
 * @param {string} locale - Locale code (e.g., 'en', 'es', 'fr', 'xx')
 * @returns {string} AliExpress domain
 */
function getAliExpressDomain(locale) {
  if (!locale || typeof locale !== 'string') {
    return 'www.aliexpress.com';
  }
  
  // Normalize locale: extract first part (e.g., 'en-US' -> 'en', 'es_ES' -> 'es')
  const normalizedLocale = locale.toLowerCase().trim().split(/[-_]/)[0];
  
  // If we have explicit mapping, use it
  if (ALIEXPRESS_DOMAINS[normalizedLocale]) {
    return ALIEXPRESS_DOMAINS[normalizedLocale];
  }
  
  // For any 2-3 letter locale code, try constructing the domain dynamically
  // This supports future/new AliExpress markets automatically
  if (LOCALE_PATTERN.test(normalizedLocale)) {
    // Check if AliExpress likely has a subdomain for this locale
    // Pattern: xx.aliexpress.com for most locales
    const constructedDomain = `${normalizedLocale}.aliexpress.com`;
    console.log(`[getAliExpressDomain] Constructed domain for locale '${normalizedLocale}': ${constructedDomain}`);
    return constructedDomain;
  }
  
  // Fallback to global site for invalid/unknown codes
  console.log(`[getAliExpressDomain] Unknown locale '${locale}', defaulting to www.aliexpress.com`);
  return 'www.aliexpress.com';
}

/**
 * Build Accept-Language HTTP header for any locale
 * Supports any language code dynamically
 * @param {string} locale - Locale code (e.g., 'es', 'fr', 'ja')
 * @returns {string} Accept-Language header value
 */
function buildAcceptLanguageHeader(locale) {
  if (!locale || typeof locale !== 'string') {
    return 'en-US,en;q=0.9';
  }
  
  const normalized = locale.toLowerCase().trim().split(/[-_]/)[0];
  
  // Map of locale to full language tag
  const localeMap = {
    'en': 'en-US',
    'es': 'es-ES',
    'fr': 'fr-FR',
    'de': 'de-DE',
    'it': 'it-IT',
    'pl': 'pl-PL',
    'nl': 'nl-NL',
    'pt': 'pt-PT',
    'ru': 'ru-RU',
    'he': 'he-IL',
    'iw': 'he-IL',
    'ar': 'ar-SA',
    'tr': 'tr-TR',
    'ja': 'ja-JP',
    'ko': 'ko-KR',
    'th': 'th-TH',
    'id': 'id-ID',
    'vi': 'vi-VN',
    'ms': 'ms-MY',
    'zh': 'zh-CN',
    'uk': 'uk-UA',
    'sv': 'sv-SE',
    'no': 'nb-NO',
    'da': 'da-DK',
    'fi': 'fi-FI',
    'cs': 'cs-CZ',
    'hu': 'hu-HU',
    'ro': 'ro-RO',
    'bg': 'bg-BG',
    'hr': 'hr-HR',
    'sk': 'sk-SK',
    'sl': 'sl-SI',
    'lt': 'lt-LT',
    'lv': 'lv-LV',
    'et': 'et-EE',
    'el': 'el-GR',
    'hi': 'hi-IN',
    'bn': 'bn-BD',
    'ta': 'ta-IN',
    'te': 'te-IN',
    'mr': 'mr-IN',
    'gu': 'gu-IN',
    'kn': 'kn-IN',
    'ml': 'ml-IN',
    'pa': 'pa-IN',
    'ur': 'ur-PK',
    'fa': 'fa-IR',
    'sw': 'sw-KE',
    'tl': 'tl-PH',
    'my': 'my-MM',
    'km': 'km-KH',
    'lo': 'lo-LA',
    'ne': 'ne-NP',
    'si': 'si-LK',
  };
  
  // For known locales, use mapped value
  if (localeMap[normalized]) {
    return `${localeMap[normalized]},${normalized};q=0.9,en-US;q=0.8`;
  }
  
  // For any 2-3 letter locale, construct dynamically
  if (/^[a-z]{2,3}$/.test(normalized)) {
    // Try common region patterns
    const region = normalized.toUpperCase();
    return `${normalized}-${region},${normalized};q=0.9,en-US;q=0.8`;
  }
  
  // Fallback
  return 'en-US,en;q=0.9';
}

/**
 * Clean image URL for visual search - remove query params and resize suffixes
 */
function cleanImageUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return imageUrl;
    
    // Remove query parameters
    let cleaned = imageUrl.split('?')[0];
    
    // Remove common resize suffixes that might interfere with visual search
    const resizePatterns = [
        /_\d+x\d+\.jpg$/i,      // _640x640.jpg, _800x800.jpg
        /_\d+x\d+\.png$/i,      // _640x640.png
        /_\d+x\d+\.jpeg$/i,     // _640x640.jpeg
        /_\d+x\d+\.webp$/i,     // _640x640.webp
        /_\d+\.jpg$/i,          // _640.jpg
        /_\d+\.png$/i,          // _640.png
        /_s\d+_\d+\.jpg$/i,     // _s500_500.jpg (some e-commerce patterns)
    ];
    
    for (const pattern of resizePatterns) {
        cleaned = cleaned.replace(pattern, '');
    }
    
    return cleaned;
}

/**
 * פונקציה שמחלצת מזהי מוצרים (Product IDs) מתוצאות חיפוש ויזואלי
 * Uses locale-specific AliExpress endpoint with browser-like headers
 * @param {string} imageUrl - Image URL to search
 * @param {Object} options - Options including locale
 * @param {string} options.locale - User locale (e.g., 'en', 'es', 'fr', 'he')
 */
async function getIdsByImage(imageUrl, options = {}) {
    try {
        // Validation: Check if imageUrl is provided and valid
        if (!imageUrl) {
            console.error('[getIdsByImage] No imageUrl provided');
            return { productIds: [], debug: { error: 'No imageUrl provided' } };
        }

        // Check for problematic URL patterns
        if (imageUrl.startsWith('data:')) {
            console.error('[getIdsByImage] Cannot search with data URI image');
            return { productIds: [], debug: { error: 'Data URI not supported', imageUrl } };
        }
        if (imageUrl.startsWith('blob:')) {
            console.error('[getIdsByImage] Cannot search with blob URL');
            return { productIds: [], debug: { error: 'Blob URL not supported', imageUrl } };
        }
        if (imageUrl.includes('localhost') || imageUrl.includes('127.0.0.1')) {
            console.error('[getIdsByImage] Cannot search with localhost image');
            return { productIds: [], debug: { error: 'Localhost images not accessible', imageUrl } };
        }

        // Clean the image URL for better visual search results
        const cleanImgUrl = cleanImageUrl(imageUrl);
        console.log('[getIdsByImage] Original URL:', imageUrl.substring(0, 80) + '...');
        console.log('[getIdsByImage] Cleaned URL:', cleanImgUrl.substring(0, 80) + '...');

        // Determine locale and domain for visual search
        const locale = options.locale || 'en';
        const domain = getAliExpressDomain(locale);
        
        console.log(`[getIdsByImage] Using locale: ${locale}, domain: ${domain}`);
        
        // Use locale-specific AliExpress visual search endpoint
        const url = `https://${domain}/glober/search/visual?imgUrl=${encodeURIComponent(cleanImgUrl)}`;

        // Build Accept-Language header dynamically for any locale
        const acceptLang = buildAcceptLanguageHeader(locale);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': acceptLang,
                'Referer': `https://${domain}/`,
                'Origin': `https://${domain}`,
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'max-age=0'
            },
            timeout: 10000,
            maxRedirects: 5
        });

        // חיפוש מזהי מוצר בתוך ה-HTML שחוזר (באמצעות Regex)
        const html = response.data;
        
        // Debug: Log response status and HTML length for troubleshooting
        console.log('[getIdsByImage] Response Status:', response.status, response.statusText);
        console.log('[getIdsByImage] Response HTML length:', html.length);
        
        const regex = /"productId":"(\d+)"/g;
        const matches = [...html.matchAll(regex)];
        
        // הוצאת המספרים בלבד והסרת כפילויות
        const productIds = [...new Set(matches.map(match => match[1]))];

        console.log('[getIdsByImage] Found', productIds.length, 'product IDs');

        // If no products found, include debug info
        if (productIds.length === 0) {
            // Check for captcha or challenge page
            const hasCaptcha = html.includes('captcha') || html.includes('verify') || html.includes('challenge');
            const isEmpty = html.length < 500;
            const hasError = html.includes('error') || html.includes('blocked');
            
            return {
                productIds: [],
                debug: {
                    htmlLength: html.length,
                    hasCaptcha,
                    isEmpty,
                    hasError,
                    imageUrl: cleanImgUrl,
                    hint: hasCaptcha ? 'AliExpress returned captcha/challenge page' : 
                          isEmpty ? 'Empty response - image may not be accessible' : 
                          hasError ? 'AliExpress returned an error page' :
                          'No products found for this image'
                }
            };
        }

        return { productIds, debug: null };
    } catch (error) {
        // Enhanced error logging with response status if available
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        const responseData = error.response?.data;
        
        console.error('[getIdsByImage] Error fetching AliExpress image search:', error.message);
        if (status) {
            console.error('[getIdsByImage] Response Status:', status, statusText);
        }
        if (responseData) {
            console.error('[getIdsByImage] Response Data preview:', String(responseData).substring(0, 200));
        }
        
        return { 
            productIds: [], 
            debug: { 
                error: error.message,
                status: status || null,
                statusText: statusText || null,
                imageUrl,
                hint: status === 403 ? 'Access blocked (403) - may need to adjust headers' :
                      status === 429 ? 'Rate limited (429) - too many requests' :
                      status >= 500 ? `AliExpress server error (${status})` :
                      'Network error or AliExpress blocked the request'
            } 
        };
    }
}

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
 * Fetch product details using AliExpress Affiliate API
 * @param {string[]} productIds - Array of product IDs
 * @returns {Promise<Object[]>} Array of product details with Title, Price, Original Price, Product Image, Affiliate Link
 */
async function getProductDetails(productIds) {
    if (!productIds || productIds.length === 0) {
        console.error('[AliExpress Service] Product IDs are required');
        return [];
    }

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
        fields: 'product_id,product_title,product_main_image_url,product_detail_url,sale_price,original_price,promotion_link',
        product_ids: limitedIds.join(','),
        tracking_id: TRACKING_ID
    };

    params.sign = generateSign(params);

    const queryString = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    try {
        console.log('[AliExpress Service] Fetching product details for', limitedIds.length, 'products');

        const response = await axios.get(`${API_URL}?${queryString}`, {
            headers: {
                'Accept': 'application/json'
            },
            timeout: 20000 // Increased from 10s to 20s for better reliability
        });

        const data = response.data;
        const products = data?.aliexpress_affiliate_product_detail_get_response?.resp_result?.result?.products?.product || [];

        console.log('[AliExpress Service] Retrieved details for', products.length, 'products');

        // Structure the response with all required fields
        return products.map((item) => ({
            title: item?.product_title || item?.title || '',
            price: item?.sale_price || item?.price || '',
            originalPrice: item?.original_price || '',
            productImage: item?.product_main_image_url || item?.imageUrl || '',
            affiliateLink: item?.promotion_link || '',
            itemUrl: item?.product_detail_url || '',
            productId: item?.product_id || item?.id || '',
            rating: item?.evaluate_rate ? parseFloat(item.evaluate_rate) : null,
            totalSales: item?.lastest_volume ? parseInt(item.lastest_volume, 10) : 0,
            discountPct: item?.discount ? parseFloat(item.discount) : 0,
            commissionRate: item?.commission_rate || '',
            storeUrl: item?.shop_url || '',
            storeName: item?.store_name || '',
            shippingCost: item?.shipping_cost || '0',
            isChoiceItem: item?.is_choice_item === 'Y' || item?.is_choice_item === true || false,
            packageWeight: item?.package_weight ? parseFloat(item.package_weight) : null,
            categoryId: item?.category_id || ''
        }));
    } catch (error) {
        console.error('[AliExpress Service] Failed to fetch product details');
        console.error(error);
        return [];
    }
}

/**
 * Search products by keyword using AliExpress Affiliate API
 * @param {string} keywords - Search keywords
 * @returns {Promise<Object[]>} Array of product details
 */
async function searchByKeywords(keywords) {
    if (!keywords || !keywords.trim()) {
        console.error('[searchByKeywords] No keywords provided');
        return [];
    }

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const params = {
        method: 'aliexpress.affiliate.product.query',
        app_key: APP_KEY,
        timestamp,
        format: 'json',
        v: '2.0',
        sign_method: 'md5',
        fields: 'product_id,product_title,product_main_image_url,product_detail_url,sale_price,original_price,promotion_link,evaluate_rate,lastest_volume,discount,commission_rate,shop_url,shipping_cost,is_choice_item',
        keywords: keywords.trim(),
        page_no: 1,
        page_size: 50,
        tracking_id: TRACKING_ID
    };

    params.sign = generateSign(params);

    const queryString = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    try {
        console.log('[searchByKeywords] Searching for:', keywords);

        const response = await axios.get(`${API_URL}?${queryString}`, {
            headers: { 'Accept': 'application/json' },
            timeout: 10000
        });

        const data = response.data;
        const products = data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];

        console.log('[searchByKeywords] Retrieved', products.length, 'products');

        // Structure the response with all required fields
        return products.map((item) => ({
            title: item?.product_title || item?.title || '',
            price: item?.sale_price || item?.price || '',
            originalPrice: item?.original_price || '',
            productImage: item?.product_main_image_url || item?.imageUrl || '',
            affiliateLink: item?.promotion_link || '',
            itemUrl: item?.product_detail_url || '',
            productId: item?.product_id || item?.id || '',
            rating: item?.evaluate_rate ? parseFloat(item.evaluate_rate) : null,
            totalSales: item?.lastest_volume ? parseInt(item.lastest_volume, 10) : 0,
            discountPct: item?.discount ? parseFloat(item.discount) : 0,
            commissionRate: item?.commission_rate || '',
            storeUrl: item?.shop_url || '',
            storeName: item?.store_name || '',
            shippingCost: item?.shipping_cost || '0',
            isChoiceItem: item?.is_choice_item === 'Y' || item?.is_choice_item === true || false,
            packageWeight: item?.package_weight ? parseFloat(item.package_weight) : null,
            categoryId: item?.category_id || ''
        }));
    } catch (error) {
        console.error('[searchByKeywords] Error:', error.message);
        return [];
    }
}

/**
 * Search for similar products using a product ID
 * Uses aliexpress.affiliate.product.query with the product ID as seed
 * @param {string} productId - AliExpress Product ID to find similar items
 * @returns {Promise<Object[]>} Array of similar product details
 */
async function searchByProductId(productId) {
  if (!productId || !productId.trim()) {
    console.error('[searchByProductId] No productId provided');
    return [];
  }

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const params = {
    method: 'aliexpress.affiliate.product.query',
    app_key: APP_KEY,
    timestamp,
    format: 'json',
    v: '2.0',
    sign_method: 'md5',
    fields: 'product_id,product_title,product_main_image_url,product_detail_url,sale_price,original_price,promotion_link,evaluate_rate,lastest_volume,discount,commission_rate,shop_url,shipping_cost,is_choice_item',
    product_id: productId.trim(),
    page_no: 1,
    page_size: 20,
    tracking_id: TRACKING_ID
  };

  params.sign = generateSign(params);

  const queryString = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  try {
    console.log('[searchByProductId] Searching similar products for productId:', productId);

    const response = await axios.get(`${API_URL}?${queryString}`, {
      headers: { 'Accept': 'application/json' },
      timeout: 10000
    });

    const data = response.data;
    const products = data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];

    console.log('[searchByProductId] Retrieved', products.length, 'similar products');

    return products.map((item) => ({
      title: item?.product_title || item?.title || '',
      price: item?.sale_price || item?.price || '',
      originalPrice: item?.original_price || '',
      productImage: item?.product_main_image_url || item?.imageUrl || '',
      affiliateLink: item?.promotion_link || '',
      itemUrl: item?.product_detail_url || '',
      productId: item?.product_id || item?.id || '',
      rating: item?.evaluate_rate ? parseFloat(item.evaluate_rate) : null,
      totalSales: item?.lastest_volume ? parseInt(item.lastest_volume, 10) : 0,
      discountPct: item?.discount ? parseFloat(item.discount) : 0,
      commissionRate: item?.commission_rate || '',
      storeUrl: item?.shop_url || '',
      storeName: item?.store_name || '',
      shippingCost: item?.shipping_cost || '0',
      isChoiceItem: item?.is_choice_item === 'Y' || item?.is_choice_item === true || false,
      packageWeight: item?.package_weight ? parseFloat(item.package_weight) : null,
      categoryId: item?.category_id || ''
    }));
  } catch (error) {
    console.error('[searchByProductId] Error:', error.message);
    return [];
  }
}

/**
 * Fetch a single page of keyword search results
 * @param {string} keywords - Search keywords
 * @param {number} pageNo - Page number (1-based)
 * @returns {Promise<Object[]>} Array of product details for that page
 */
async function searchByKeywordsPage(keywords, pageNo = 1, sort = '') {
    if (!keywords || !keywords.trim()) return [];

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const params = {
        method: 'aliexpress.affiliate.product.query',
        app_key: APP_KEY,
        timestamp,
        format: 'json',
        v: '2.0',
        sign_method: 'md5',
        fields: 'product_id,product_title,product_main_image_url,product_detail_url,sale_price,original_price,promotion_link,evaluate_rate,lastest_volume,discount,commission_rate,shop_url,shipping_cost,is_choice_item',
        keywords: keywords.trim(),
        page_no: pageNo,
        page_size: 100, // Maximum page size for maximum products per request
        tracking_id: TRACKING_ID
    };

    // Add sort parameter if provided
    if (sort) {
        params.sort = sort;
    }

    params.sign = generateSign(params);

    const queryString = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    try {
        const response = await axios.get(`${API_URL}?${queryString}`, {
            headers: { 'Accept': 'application/json' },
            timeout: 15000 // Increased from 10s to 15s for better reliability
        });

        const data = response.data;
        const products = data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];

        return products.map((item) => ({
            title: item?.product_title || item?.title || '',
            price: item?.sale_price || item?.price || '',
            originalPrice: item?.original_price || '',
            productImage: item?.product_main_image_url || item?.imageUrl || '',
            affiliateLink: item?.promotion_link || '',
            itemUrl: item?.product_detail_url || '',
            productId: item?.product_id || item?.id || '',
            rating: item?.evaluate_rate ? parseFloat(item.evaluate_rate) : null,
            totalSales: item?.lastest_volume ? parseInt(item.lastest_volume, 10) : 0,
            discountPct: item?.discount ? parseFloat(item.discount) : 0,
            commissionRate: item?.commission_rate || '',
            storeUrl: item?.shop_url || '',
            storeName: item?.store_name || '',
            shippingCost: item?.shipping_cost || '0',
            isChoiceItem: item?.is_choice_item === 'Y' || item?.is_choice_item === true || false,
            packageWeight: item?.package_weight ? parseFloat(item.package_weight) : null,
            categoryId: item?.category_id || ''
        }));
    } catch (error) {
        console.error(`[searchByKeywordsPage] Page ${pageNo} error:`, error.message);
        return [];
    }
}

/**
 * Sort strategies to diversify product pools and maximize unique results.
 * Each sort order surfaces different products from the AliExpress catalog.
 */
const SORT_STRATEGIES = [
    '',                   // Default (best match / relevance)
    'LAST_VOLUME_DESC',   // Most sold first
    'SALE_PRICE_ASC',     // Cheapest first
    'SALE_PRICE_DESC',    // Most expensive first
    'EVALUATE_RATE_DESC', // Top rated first — surfaces high-quality items from different sellers
    'NEWEST_DESC'         // Newest products first — surfaces fresh inventory
];

/**
 * Fetch pages for a single sort order with chunked concurrency.
 * @param {string} keywords
 * @param {string} sort - Sort parameter
 * @param {number} maxPages - Max pages for this sort
 * @param {number} chunkSize - Concurrent requests per wave
 * @param {Set} seen - Shared dedup set
 * @param {Object[]} allProducts - Shared output array
 * @returns {Promise<number>} Number of new products added
 */
async function fetchSortedBatch(keywords, sort, maxPages, chunkSize, seen, allProducts, targetCount = 1000) {
    const sortLabel = sort || 'DEFAULT';
    let totalNew = 0;
    let lowYieldChunks = 0;

    for (let chunkStart = 1; chunkStart <= maxPages; chunkStart += chunkSize) {
        // Early exit if the shared pool already hit target
        if (allProducts.length >= targetCount) {
            console.log(`  [${sortLabel}] Target ${targetCount} already reached (${allProducts.length}), stopping`);
            break;
        }
        const chunkEnd = Math.min(chunkStart + chunkSize - 1, maxPages);
        const chunkPages = [];
        for (let page = chunkStart; page <= chunkEnd; page++) {
            chunkPages.push(page);
        }

        const chunkResults = await Promise.all(
            chunkPages.map(pageNo => searchByKeywordsPage(keywords, pageNo, sort))
        );

        let chunkNewCount = 0;
        for (const pageProducts of chunkResults) {
            for (const product of pageProducts) {
                const pid = String(product.productId);
                if (pid && !seen.has(pid)) {
                    seen.add(pid);
                    allProducts.push(product);
                    chunkNewCount++;
                }
            }
        }

        totalNew += chunkNewCount;
        console.log(`  [${sortLabel}] pages ${chunkStart}-${chunkEnd}: +${chunkNewCount} new (${allProducts.length} total)`);

        // Very relaxed early termination: only stop after 5 consecutive zero-yield chunks
        // Continue fetching aggressively to maximize raw pool for quality selection
        if (chunkNewCount === 0) {
            lowYieldChunks++;
            if (lowYieldChunks >= 5) {
                console.log(`  [${sortLabel}] Early exit: 5 consecutive zero-yield chunks`);
                break;
            }
        } else {
            lowYieldChunks = 0;
        }
    }

    return totalNew;
}

/**
 * Optimized batch search targeting exactly 1,000 unique results.
 * Uses aggressive parallelization with chunked concurrency.
 * @param {string} keywords - Search keywords
 * @param {number} targetCount - Target number of unique products (default: 1000)
 * @param {number} chunkSize - Concurrent requests per wave (default: 15 for speed)
 * @returns {Promise<Object[]>} Array of unique product details
 */
async function searchByKeywordsBatch(keywords, targetCount = 1000, chunkSize = 15) {
    if (!keywords || !keywords.trim()) {
        console.error('[searchByKeywordsBatch] No keywords provided');
        return [];
    }

    // Calculate pages per sort to reach target efficiently
    // Each page returns ~100 products, but with dedup we need more
    // Target: 1000 products / 6 sorts = ~167 per sort / ~50 per page after dedup = ~4 pages per sort
    // Using up to 100 pages per sort for maximum coverage (6000+ potential unique products)
    const pagesPerSort = Math.min(Math.ceil((targetCount * 2) / SORT_STRATEGIES.length / 40), 100);
    const effectiveChunkSize = Math.min(Math.max(chunkSize, 12), 20); // Increased to 12-20 for faster retrieval

    console.log(`[searchByKeywordsBatch] Target: ${targetCount} products | ${SORT_STRATEGIES.length} sorts × ${pagesPerSort} pages | chunks of ${effectiveChunkSize}`);
    const startTime = Date.now();

    const seen = new Set();
    const allProducts = [];

    // Run ALL sort strategies in parallel with early exit when target reached
    const sortLabels = SORT_STRATEGIES.map(s => s || 'DEFAULT').join(', ');
    console.log(`[searchByKeywordsBatch] Parallel strategies: [${sortLabels}]`);

    await Promise.all(
        SORT_STRATEGIES.map(sort =>
            fetchSortedBatch(keywords, sort, pagesPerSort, effectiveChunkSize, seen, allProducts, targetCount)
        )
    );

    const elapsed = Date.now() - startTime;
    console.log(`[searchByKeywordsBatch] DONE: ${allProducts.length} unique products in ${elapsed}ms (target: ${targetCount})`);

    return allProducts;
}

/**
 * Find alternative sellers that carry multiple items from a cart
 * Identifies "Super-Sellers" or "AliExpress Choice" stores for bundle optimization
 *
 * @param {string[]} productIds - Array of product IDs from the cart
 * @param {Function} contentFilter - Optional content filter function (The Shield)
 * @returns {Promise<Array>} Array of bundles: { storeId, storeUrl, storeName, products: [], isChoiceStore, matchCount }
 */
async function findAlternativeSellers(productIds, contentFilter = null) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
        console.error('[findAlternativeSellers] No productIds provided');
        return [];
    }

    console.log(`[findAlternativeSellers] Analyzing ${productIds.length} cart items for bundle opportunities`);
    const startTime = Date.now();

    // Step 1: Fetch alternative products for each cart item
    const storeProductMap = new Map(); // storeId -> { products: Set(), storeUrl, storeName, isChoiceCount }

    const searchPromises = productIds.map(async (originalProductId) => {
        try {
            // Search for similar/alternative products for this cart item
            const alternatives = await searchByProductId(originalProductId);

            if (!Array.isArray(alternatives) || alternatives.length === 0) {
                return { originalProductId, alternatives: [] };
            }

            return { originalProductId, alternatives };
        } catch (error) {
            console.error(`[findAlternativeSellers] Error searching for ${originalProductId}:`, error.message);
            return { originalProductId, alternatives: [] };
        }
    });

    const searchResults = await Promise.all(searchPromises);

    // Step 2: Build store-to-products mapping
    for (const { originalProductId, alternatives } of searchResults) {
        for (const alt of alternatives) {
            // Extract store ID from storeUrl
            const storeId = extractStoreIdFromUrl(alt.storeUrl);
            if (!storeId) continue;

            // Initialize store entry if needed
            if (!storeProductMap.has(storeId)) {
                storeProductMap.set(storeId, {
                    storeId,
                    storeUrl: alt.storeUrl || '',
                    storeName: alt.storeName || extractStoreNameFromUrl(alt.storeUrl) || '',
                    products: new Set(),
                    isChoiceCount: 0,
                    totalRating: 0,
                    ratingCount: 0
                });
            }

            const storeEntry = storeProductMap.get(storeId);

            // Add the original product this alternative represents
            storeEntry.products.add({
                originalProductId,
                alternativeProductId: alt.productId,
                alternativeTitle: alt.title,
                alternativePrice: alt.price,
                alternativeImage: alt.productImage
            });

            // Track Choice store indicator
            if (alt.isChoiceItem) {
                storeEntry.isChoiceCount++;
            }

            // Track rating for quality scoring
            if (alt.rating && alt.rating > 0) {
                storeEntry.totalRating += alt.rating;
                storeEntry.ratingCount++;
            }
        }
    }

    // Step 3: Filter and build bundles (stores with 2+ products from cart)
    const bundles = [];

    for (const storeEntry of storeProductMap.values()) {
        // Only include stores that have alternatives for 2+ cart items
        if (storeEntry.products.size >= 2) {
            const avgRating = storeEntry.ratingCount > 0
                ? storeEntry.totalRating / storeEntry.ratingCount
                : 0;

            const bundle = {
                storeId: storeEntry.storeId,
                storeUrl: storeEntry.storeUrl,
                storeName: storeEntry.storeName,
                matchCount: storeEntry.products.size,
                isChoiceStore: storeEntry.isChoiceCount > (storeEntry.products.size / 2),
                avgRating: parseFloat(avgRating.toFixed(2)),
                products: Array.from(storeEntry.products)
            };

            bundles.push(bundle);
        }
    }

    // Step 4: Apply content filter if provided (The Shield)
    let finalBundles = bundles;
    if (contentFilter && typeof contentFilter === 'function') {
        // Filter each bundle's products through content filter
        finalBundles = bundles.map(bundle => {
            const filteredProducts = bundle.products.filter(p => {
                // Create a mock product object for filtering
                const mockProduct = {
                    title: p.alternativeTitle,
                    productId: p.alternativeProductId
                };
                const filterResult = contentFilter([mockProduct]);
                return filterResult.filtered && filterResult.filtered.length > 0;
            });

            return {
                ...bundle,
                products: filteredProducts,
                matchCount: filteredProducts.length
            };
        }).filter(bundle => bundle.matchCount >= 2); // Re-check minimum after filtering
    }

    // Sort by match count (descending), then by Choice status, then by rating
    finalBundles.sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        if (b.isChoiceStore !== a.isChoiceStore) return b.isChoiceStore ? 1 : -1;
        return b.avgRating - a.avgRating;
    });

    const elapsed = Date.now() - startTime;
    console.log(`[findAlternativeSellers] Found ${finalBundles.length} bundles in ${elapsed}ms`);

    // Log bundle summary
    for (const bundle of finalBundles) {
        console.log(`  [Bundle] ${bundle.storeName} (${bundle.storeId}): ${bundle.matchCount} products, Choice: ${bundle.isChoiceStore}, Rating: ${bundle.avgRating}`);
    }

    return finalBundles;
}

/**
 * Extract store ID from AliExpress store URL
 */
function extractStoreIdFromUrl(storeUrl) {
    if (!storeUrl || typeof storeUrl !== 'string') return null;
    const match = storeUrl.match(/\/store\/(\d+)/);
    return match ? match[1] : null;
}

/**
 * Extract store name from URL (fallback when storeName not provided)
 */
function extractStoreNameFromUrl(storeUrl) {
    if (!storeUrl || typeof storeUrl !== 'string') return null;
    // Extract store ID as fallback name
    const storeId = extractStoreIdFromUrl(storeUrl);
    return storeId ? `Store ${storeId}` : null;
}

module.exports = { getIdsByImage, getProductDetails, searchByKeywords, searchByProductId, searchByKeywordsBatch, findAlternativeSellers };
