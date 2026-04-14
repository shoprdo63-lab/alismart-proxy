const axios = require('axios');
const crypto = require('crypto');

const APP_KEY = process.env.ALI_APP_KEY || '528438';
const APP_SECRET = process.env.ALI_APP_SECRET || 'YPhzjbGESFs75SniEK0t1wwfKhvrKIhq';
const TRACKING_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const API_URL = 'https://api-sg.aliexpress.com/sync';

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
 * Uses he.aliexpress.com endpoint with browser-like headers
 */
async function getIdsByImage(imageUrl) {
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

        // Try the new he.aliexpress.com visual search endpoint with browser headers
        const url = `https://he.aliexpress.com/glober/search/visual?imgUrl=${encodeURIComponent(cleanImgUrl)}`;

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.aliexpress.com/',
                'Origin': 'https://www.aliexpress.com',
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
            timeout: 10000
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
            affiliateLink: item?.promotion_link || item?.product_detail_url || '',
            productId: item?.product_id || item?.id || '',
            rating: item?.evaluate_rate ? parseFloat(item.evaluate_rate) : null,
            totalSales: item?.lastest_volume ? parseInt(item.lastest_volume, 10) : 0,
            discountPct: item?.discount ? parseFloat(item.discount) : 0,
            commissionRate: item?.commission_rate || '',
            storeUrl: item?.shop_url || '',
            shippingCost: item?.shipping_cost || '0',
            isChoiceItem: item?.is_choice_item === 'Y' || item?.is_choice_item === true || false
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
            affiliateLink: item?.promotion_link || item?.product_detail_url || '',
            productId: item?.product_id || item?.id || '',
            rating: item?.evaluate_rate ? parseFloat(item.evaluate_rate) : null,
            totalSales: item?.lastest_volume ? parseInt(item.lastest_volume, 10) : 0,
            discountPct: item?.discount ? parseFloat(item.discount) : 0,
            commissionRate: item?.commission_rate || '',
            storeUrl: item?.shop_url || '',
            shippingCost: item?.shipping_cost || '0',
            isChoiceItem: item?.is_choice_item === 'Y' || item?.is_choice_item === true || false
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
      affiliateLink: item?.promotion_link || item?.product_detail_url || '',
      productId: item?.product_id || item?.id || '',
      rating: item?.evaluate_rate ? parseFloat(item.evaluate_rate) : null,
      totalSales: item?.lastest_volume ? parseInt(item.lastest_volume, 10) : 0,
      discountPct: item?.discount ? parseFloat(item.discount) : 0,
      commissionRate: item?.commission_rate || '',
      storeUrl: item?.shop_url || '',
      shippingCost: item?.shipping_cost || '0',
      isChoiceItem: item?.is_choice_item === 'Y' || item?.is_choice_item === true || false
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
        page_size: 50,
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
            timeout: 10000
        });

        const data = response.data;
        const products = data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];

        return products.map((item) => ({
            title: item?.product_title || item?.title || '',
            price: item?.sale_price || item?.price || '',
            originalPrice: item?.original_price || '',
            productImage: item?.product_main_image_url || item?.imageUrl || '',
            affiliateLink: item?.promotion_link || item?.product_detail_url || '',
            productId: item?.product_id || item?.id || '',
            rating: item?.evaluate_rate ? parseFloat(item.evaluate_rate) : null,
            totalSales: item?.lastest_volume ? parseInt(item.lastest_volume, 10) : 0,
            discountPct: item?.discount ? parseFloat(item.discount) : 0,
            commissionRate: item?.commission_rate || '',
            storeUrl: item?.shop_url || '',
            shippingCost: item?.shipping_cost || '0',
            isChoiceItem: item?.is_choice_item === 'Y' || item?.is_choice_item === true || false
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
    'SALE_PRICE_DESC'     // Most expensive first
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

        // Aggressive early termination: stop this sort if chunk yields < 3 new products
        if (chunkNewCount < 3) {
            lowYieldChunks++;
            if (lowYieldChunks >= 2) {
                console.log(`  [${sortLabel}] Early exit: low yield (${chunkNewCount} new in last chunk)`);
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
 * @param {number} chunkSize - Concurrent requests per wave (default: 10 for speed)
 * @returns {Promise<Object[]>} Array of unique product details
 */
async function searchByKeywordsBatch(keywords, targetCount = 1000, chunkSize = 10) {
    if (!keywords || !keywords.trim()) {
        console.error('[searchByKeywordsBatch] No keywords provided');
        return [];
    }

    // Calculate pages per sort to reach target efficiently
    // Each page returns ~20 products, but with dedup we need more
    // Target: 1000 products / 4 sorts = ~250 per sort / ~20 per page = ~13 pages per sort
    const pagesPerSort = Math.min(Math.ceil((targetCount * 1.5) / SORT_STRATEGIES.length / 20), 25);
    const effectiveChunkSize = Math.min(Math.max(chunkSize, 8), 15); // Clamp between 8-15 for optimal speed

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

module.exports = { getIdsByImage, getProductDetails, searchByKeywords, searchByProductId, searchByKeywordsBatch };
