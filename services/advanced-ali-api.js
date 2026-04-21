const axios = require('axios');
const crypto = require('crypto');

const APP_KEY = process.env.ALI_APP_KEY || '528438';
const APP_SECRET = process.env.ALI_APP_SECRET || 'YPhzjbGESFs75SniEK0t1wwfKhvrKIhq';
const TRACKING_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const API_URL = 'https://api-sg.aliexpress.com/sync';

/**
 * AliExpress Advanced API Integration
 * Uses Advanced API features available with App Key 528438
 */

function generateSign(params) {
  const sortedKeys = Object.keys(params).sort();
  const sortedParams = sortedKeys.map((key) => `${key}${params[key]}`).join('');
  const signString = APP_SECRET + sortedParams + APP_SECRET;
  return crypto.createHash('md5').update(signString).digest('hex').toUpperCase();
}

async function callAliExpressAPI(method, extraParams = {}) {
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const params = {
    method,
    app_key: APP_KEY,
    timestamp,
    format: 'json',
    v: '2.0',
    sign_method: 'md5',
    tracking_id: TRACKING_ID,
    target_currency: 'USD',
    target_language: 'EN',
    ...extraParams
  };

  params.sign = generateSign(params);

  const queryString = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  try {
    const response = await axios.get(`${API_URL}?${queryString}`, {
      timeout: 30000
    });
    
    const data = response.data;
    
    if (data.error_response) {
      throw new Error(data.error_response.sub_msg || data.error_response.msg);
    }
    
    return data;
  } catch (error) {
    console.error(`[Advanced API] ${method} failed:`, error.message);
    throw error;
  }
}

/**
 * Get Hot Products (Advanced API)
 * Returns trending/hot selling products
 */
async function getHotProducts(options = {}) {
  const {
    keywords = '',
    categoryId = '',
    pageSize = 50,
    pageNo = 1,
    sort = 'hot_degree_desc' // hot_degree_desc, commission_rate_desc
  } = options;

  const params = {
    keywords,
    page_size: pageSize,
    page_no: pageNo,
    sort,
    fields: 'product_id,product_title,product_main_image_url,sale_price,original_price,discount,commission_rate,hot_product_commission_rate,lastest_volume,evaluate_rate,shop_url,is_choice_item'
  };

  if (categoryId) {
    params.category_id = categoryId;
  }

  const data = await callAliExpressAPI('aliexpress.affiliate.hotproduct.query', params);
  
  const products = data?.aliexpress_affiliate_hotproduct_query_response?.resp_result?.result?.products?.product || [];
  
  return products.map(item => ({
    productId: item.product_id,
    title: item.product_title,
    imageUrl: item.product_main_image_url,
    price: item.sale_price,
    originalPrice: item.original_price,
    discount: item.discount,
    commissionRate: item.commission_rate,
    hotCommissionRate: item.hot_product_commission_rate,
    sales: item.lastest_volume,
    rating: item.evaluate_rate,
    storeUrl: item.shop_url,
    isChoiceItem: item.is_choice_item === 'Y',
    isHotProduct: true, // Mark as hot product
    hotScore: calculateHotScore(item)
  }));
}

/**
 * Get Featured Promotion Products (Advanced API)
 * Returns products from special promotions
 */
async function getFeaturedPromoProducts(options = {}) {
  const {
    pageSize = 50,
    pageNo = 1,
    promoName = '' // Optional: specific promotion name
  } = options;

  const params = {
    page_size: pageSize,
    page_no: pageNo,
    fields: 'product_id,product_title,product_main_image_url,sale_price,original_price,discount,commission_rate,lastest_volume,evaluate_rate,shop_url,promotion_name'
  };

  if (promoName) {
    params.promotion_name = promoName;
  }

  const data = await callAliExpressAPI('aliexpress.affiliate.featuredpromo.products.get', params);
  
  const products = data?.aliexpress_affiliate_featuredpromo_products_get_response?.resp_result?.result?.products?.product || [];
  
  return products.map(item => ({
    productId: item.product_id,
    title: item.product_title,
    imageUrl: item.product_main_image_url,
    price: item.sale_price,
    originalPrice: item.original_price,
    discount: item.discount,
    commissionRate: item.commission_rate,
    sales: item.lastest_volume,
    rating: item.evaluate_rate,
    storeUrl: item.shop_url,
    promotionName: item.promotion_name,
    isPromoProduct: true,
    discountValue: calculateDiscountValue(item)
  }));
}

/**
 * Combined Advanced Search
 * Merges results from multiple Advanced API methods
 */
async function advancedProductSearch(query, options = {}) {
  console.log(`[Advanced Search] Starting for: "${query}"`);
  
  const { 
    useHotProducts = true,
    usePromoProducts = true,
    useStandardSearch = true,
    targetCount = 1000
  } = options;

  const allProducts = [];
  const seenIds = new Set();

  // 1. Standard product search
  if (useStandardSearch) {
    try {
      console.log('[Advanced Search] Fetching standard products...');
      const standardProducts = await fetchStandardProducts(query, 500);
      for (const p of standardProducts) {
        if (!seenIds.has(p.productId)) {
          seenIds.add(p.productId);
          allProducts.push(p);
        }
      }
      console.log(`[Advanced Search] Standard: ${standardProducts.length} products`);
    } catch (e) {
      console.error('[Advanced Search] Standard search failed:', e.message);
    }
  }

  // 2. Hot products
  if (useHotProducts) {
    try {
      console.log('[Advanced Search] Fetching hot products...');
      const hotProducts = await getHotProducts({ 
        keywords: query, 
        pageSize: 200 
      });
      for (const p of hotProducts) {
        if (!seenIds.has(p.productId)) {
          seenIds.add(p.productId);
          allProducts.push(p);
        }
      }
      console.log(`[Advanced Search] Hot products: ${hotProducts.length} products`);
    } catch (e) {
      console.error('[Advanced Search] Hot products failed:', e.message);
    }
  }

  // 3. Featured promo products
  if (usePromoProducts) {
    try {
      console.log('[Advanced Search] Fetching promo products...');
      const promoProducts = await getFeaturedPromoProducts({ pageSize: 200 });
      // Filter promo products that match query
      const filteredPromo = promoProducts.filter(p => 
        p.title.toLowerCase().includes(query.toLowerCase())
      );
      for (const p of filteredPromo) {
        if (!seenIds.has(p.productId)) {
          seenIds.add(p.productId);
          allProducts.push(p);
        }
      }
      console.log(`[Advanced Search] Promo products: ${filteredPromo.length} products`);
    } catch (e) {
      console.error('[Advanced Search] Promo products failed:', e.message);
    }
  }

  console.log(`[Advanced Search] Total unique products: ${allProducts.length}`);
  return allProducts;
}

/**
 * Fetch standard products using product.query
 */
async function fetchStandardProducts(keywords, targetCount = 500) {
  const products = [];
  const seen = new Set();
  
  const pageSize = 50;
  const pagesNeeded = Math.ceil(targetCount / pageSize);

  for (let page = 1; page <= pagesNeeded; page++) {
    const params = {
      keywords,
      page_size: pageSize,
      page_no: page,
      fields: 'product_id,product_title,product_main_image_url,sale_price,original_price,discount,commission_rate,lastest_volume,evaluate_rate,shop_url,is_choice_item'
    };

    const data = await callAliExpressAPI('aliexpress.affiliate.product.query', params);
    const pageProducts = data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];
    
    if (pageProducts.length === 0) break;

    for (const item of pageProducts) {
      const id = item.product_id;
      if (!seen.has(id)) {
        seen.add(id);
        products.push({
          productId: id,
          title: item.product_title,
          imageUrl: item.product_main_image_url,
          price: item.sale_price,
          originalPrice: item.original_price,
          discount: item.discount,
          commissionRate: item.commission_rate,
          sales: item.lastest_volume,
          rating: item.evaluate_rate,
          storeUrl: item.shop_url,
          isChoiceItem: item.is_choice_item === 'Y'
        });
      }
    }

    if (products.length >= targetCount) break;
    
    // Small delay between pages
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return products.slice(0, targetCount);
}

// Helper functions
function calculateHotScore(item) {
  const sales = parseInt(item.lastest_volume) || 0;
  const hotCommission = parseFloat(item.hot_product_commission_rate) || 0;
  const rating = parseFloat(item.evaluate_rate) || 0;
  
  // Hot score based on sales volume, commission boost, and rating
  return Math.min(100, 
    (Math.log10(sales + 1) * 20) + 
    (hotCommission * 2) + 
    (rating * 5)
  );
}

function calculateDiscountValue(item) {
  const original = parseFloat(item.original_price) || 0;
  const sale = parseFloat(item.sale_price) || 0;
  
  if (original > 0 && sale > 0) {
    return Math.round(((original - sale) / original) * 100);
  }
  return 0;
}

module.exports = {
  getHotProducts,
  getFeaturedPromoProducts,
  advancedProductSearch,
  callAliExpressAPI
};
