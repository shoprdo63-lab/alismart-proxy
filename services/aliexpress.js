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
        // הכתובת של עלי-אקספרס לחיפוש תמונות
        const url = `https://www.aliexpress.com/fn/search-image/index?imageAddress=${encodeURIComponent(imageUrl)}`;

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });

        // חיפוש מזהי מוצר בתוך ה-HTML שחוזר (באמצעות Regex)
        const html = response.data;
        const regex = /"productId":"(\d+)"/g;
        const matches = [...html.matchAll(regex)];
        
        // הוצאת המספרים בלבד והסרת כפילויות
        const productIds = [...new Set(matches.map(match => match[1]))];

        return productIds;
    } catch (error) {
        console.error('Error fetching AliExpress image search:', error.message);
        return [];
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

module.exports = { getIdsByImage, getProductDetails };
