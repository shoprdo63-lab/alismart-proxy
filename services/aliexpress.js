const axios = require('axios');
const crypto = require('crypto');

const APP_KEY = process.env.ALI_APP_KEY || '528438';
const APP_SECRET = process.env.ALI_APP_SECRET || 'YPhzjbGESFs75SniEK0t1wwfKhvrKIhq';
const TRACKING_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const API_URL = 'https://api-sg.aliexpress.com/sync';

/**
 * פונקציה שמחלצת מזהי מוצרים (Product IDs) מתוצאות חיפוש ויזואלי
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

        console.log('[getIdsByImage] Searching with imageUrl:', imageUrl);

        // הכתובת של עלי-אקספרס לחיפוש תמונות
        const url = `https://www.aliexpress.com/fn/search-image/index?imageAddress=${encodeURIComponent(imageUrl)}`;

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 15000
        });

        // חיפוש מזהי מוצר בתוך ה-HTML שחוזר (באמצעות Regex)
        const html = response.data;
        
        // Debug: Log HTML length and check for common error indicators
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
            
            return {
                productIds: [],
                debug: {
                    htmlLength: html.length,
                    hasCaptcha,
                    isEmpty,
                    imageUrl,
                    hint: hasCaptcha ? 'AliExpress returned captcha/challenge page' : 
                          isEmpty ? 'Empty response - image may not be accessible' : 
                          'No products found for this image'
                }
            };
        }

        return { productIds, debug: null };
    } catch (error) {
        console.error('[getIdsByImage] Error fetching AliExpress image search:', error.message);
        return { 
            productIds: [], 
            debug: { 
                error: error.message, 
                imageUrl,
                hint: 'Network error or AliExpress blocked the request'
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

        // Structure the response with the required fields
        return products.map((item) => ({
            title: item?.product_title || item?.title || '',
            price: item?.sale_price || item?.price || '',
            originalPrice: item?.original_price || '',
            productImage: item?.product_main_image_url || item?.imageUrl || '',
            affiliateLink: item?.promotion_link || item?.product_detail_url || '',
            productId: item?.product_id || item?.id || ''
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
        fields: 'product_id,product_title,product_main_image_url,product_detail_url,sale_price,original_price,promotion_link',
        keywords: keywords.trim(),
        page_no: 1,
        page_size: 20,
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

        return products.map((item) => ({
            title: item?.product_title || item?.title || '',
            price: item?.sale_price || item?.price || '',
            originalPrice: item?.original_price || '',
            productImage: item?.product_main_image_url || item?.imageUrl || '',
            affiliateLink: item?.promotion_link || item?.product_detail_url || '',
            productId: item?.product_id || item?.id || ''
        }));
    } catch (error) {
        console.error('[searchByKeywords] Error:', error.message);
        return [];
    }
}

module.exports = { getIdsByImage, getProductDetails, searchByKeywords };
