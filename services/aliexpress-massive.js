const axios = require('axios');
const crypto = require('crypto');

const APP_KEY = process.env.ALI_APP_KEY || '528438';
const APP_SECRET = process.env.ALI_APP_SECRET || 'YPhzjbGESFs75SniEK0t1wwfKhvrKIhq';
const TRACKING_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const API_URL = 'https://api-sg.aliexpress.com/sync';

/**
 * AliExpress Massive Search Strategy
 * Fetches 100,000+ products from AliExpress using multiple strategies
 */

// 10 Sort strategies for maximum product diversity
const SORT_STRATEGIES = [
  { name: 'RELEVANCE', value: '' },
  { name: 'BEST_SELLERS', value: 'LAST_VOLUME_DESC' },
  { name: 'PRICE_LOW', value: 'SALE_PRICE_ASC' },
  { name: 'PRICE_HIGH', value: 'SALE_PRICE_DESC' },
  { name: 'TOP_RATED', value: 'EVALUATE_RATE_DESC' },
  { name: 'NEWEST', value: 'NEWEST_DESC' },
  { name: 'BIGGEST_DISCOUNT', value: 'DISCOUNT_DESC' },
  { name: 'HIGHEST_COMMISSION', value: 'COMMISSION_RATE_DESC' },
  { name: 'MOST_REVIEWS', value: 'FEEDBACK_COUNT_DESC' },
  { name: 'CHOICE_ITEMS', value: 'CHOICE' }
];

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
 * Fetch a single page of keyword search results
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
    fields: 'product_id,product_title,product_main_image_url,product_detail_url,sale_price,original_price,promotion_link,evaluate_rate,lastest_volume,discount,commission_rate,shop_url,shop_name,shipping_cost,is_choice_item,category_id',
    keywords: keywords.trim(),
    page_no: pageNo,
    page_size: 100,
    tracking_id: TRACKING_ID
  };

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
      timeout: 20000
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
      storeName: item?.shop_name || '',
      shippingCost: item?.shipping_cost || '0',
      isChoiceItem: item?.is_choice_item === 'Y' || item?.is_choice_item === true || false,
      categoryId: item?.category_id || ''
    }));
  } catch (error) {
    console.error(`[AliExpress Massive] Page ${pageNo} error:`, error.message);
    return [];
  }
}

/**
 * Fetch products using a single sort strategy
 * Fetches up to 150 pages (15,000 products) per strategy
 */
async function fetchBySortStrategy(keywords, sortStrategy, maxPages = 150) {
  const { name, value } = sortStrategy;
  console.log(`[AliExpress Massive] Strategy: ${name} - fetching up to ${maxPages} pages`);
  
  const seen = new Set();
  const products = [];
  let consecutiveEmpty = 0;
  const chunkSize = 10; // Fetch 10 pages at a time

  for (let startPage = 1; startPage <= maxPages; startPage += chunkSize) {
    if (consecutiveEmpty >= 5) {
      console.log(`[AliExpress Massive] ${name}: Stopping after 5 consecutive empty pages`);
      break;
    }

    const endPage = Math.min(startPage + chunkSize - 1, maxPages);
    const pagePromises = [];

    for (let page = startPage; page <= endPage; page++) {
      pagePromises.push(searchByKeywordsPage(keywords, page, value));
    }

    const chunkResults = await Promise.all(pagePromises);
    let chunkNewCount = 0;

    for (const pageProducts of chunkResults) {
      for (const product of pageProducts) {
        const pid = String(product.productId);
        if (pid && !seen.has(pid)) {
          seen.add(pid);
          products.push(product);
          chunkNewCount++;
        }
      }
    }

    console.log(`[AliExpress Massive] ${name}: pages ${startPage}-${endPage}: +${chunkNewCount} new (${products.length} total)`);

    if (chunkNewCount === 0) {
      consecutiveEmpty++;
    } else {
      consecutiveEmpty = 0;
    }

    // Small delay to respect rate limits
    if (endPage < maxPages) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`[AliExpress Massive] ${name}: Completed with ${products.length} unique products`);
  return products;
}

/**
 * Strategy 1: Multi-Sort Deep Dive
 * Fetches products using all 10 sort strategies in parallel
 */
async function fetchMultiSortDeepDive(keywords, targetCount = 35000) {
  console.log(`[AliExpress Massive] Starting Multi-Sort Deep Dive for "${keywords}"`);
  const startTime = Date.now();

  // Run all 10 strategies in parallel
  const strategyPromises = SORT_STRATEGIES.map(strategy => 
    fetchBySortStrategy(keywords, strategy, 150)
  );

  const allResults = await Promise.all(strategyPromises);
  
  // Merge and deduplicate
  const seen = new Set();
  const allProducts = [];

  for (const strategyProducts of allResults) {
    for (const product of strategyProducts) {
      const pid = String(product.productId);
      if (pid && !seen.has(pid)) {
        seen.add(pid);
        allProducts.push(product);
      }
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[AliExpress Massive] Multi-Sort Deep Dive: ${allProducts.length} unique products in ${elapsed}ms`);

  return allProducts;
}

/**
 * Strategy 2: Query Variations
 * Generates semantic variations and searches each
 */
async function fetchQueryVariations(baseKeywords, targetCount = 25000) {
  console.log(`[AliExpress Massive] Starting Query Variations for "${baseKeywords}"`);
  
  // Generate variations (simplified - in production would use NLP)
  const variations = generateQueryVariations(baseKeywords);
  console.log(`[AliExpress Massive] Generated ${variations.length} query variations:`, variations);

  const seen = new Set();
  const allProducts = [];

  for (const variation of variations) {
    // Fetch 30 pages per variation
    for (let page = 1; page <= 30; page++) {
      const pageProducts = await searchByKeywordsPage(variation, page, '');
      
      for (const product of pageProducts) {
        const pid = String(product.productId);
        if (pid && !seen.has(pid)) {
          seen.add(pid);
          allProducts.push(product);
        }
      }

      if (pageProducts.length === 0) break;
      
      // Stop if we hit target
      if (allProducts.length >= targetCount) break;
    }

    if (allProducts.length >= targetCount) break;
    
    // Delay between variations
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`[AliExpress Massive] Query Variations: ${allProducts.length} unique products`);
  return allProducts;
}

/**
 * Generate semantic variations of search query
 */
function generateQueryVariations(baseQuery) {
  const variations = [baseQuery];
  const lower = baseQuery.toLowerCase();
  
  // Add common e-commerce modifiers
  const modifiers = ['best', 'top', 'quality', 'cheap', 'premium', 'new', 'hot'];
  
  // Extract potential product type and attributes
  const words = lower.split(/\s+/);
  
  // Add simple variations
  if (words.length >= 2) {
    // Try different word order or combinations
    for (const modifier of modifiers.slice(0, 3)) {
      variations.push(`${modifier} ${baseQuery}`);
    }
    
    // Add singular/plural variations
    const lastWord = words[words.length - 1];
    if (lastWord.endsWith('s')) {
      variations.push(words.slice(0, -1).concat(lastWord.slice(0, -1)).join(' '));
    } else {
      variations.push(words.concat(lastWord + 's').join(' '));
    }
  }
  
  // Keep only unique variations
  return [...new Set(variations)].slice(0, 5);
}

/**
 * Strategy 3: Seller Expansion
 * Fetches all products from top sellers
 */
async function fetchSellerExpansion(seedProducts, targetCount = 20000) {
  console.log(`[AliExpress Massive] Starting Seller Expansion with ${seedProducts.length} seed products`);
  
  // Get unique sellers from top products
  const sellerUrls = [...new Set(
    seedProducts
      .slice(0, 500)
      .map(p => p.storeUrl)
      .filter(url => url)
  )].slice(0, 50); // Top 50 sellers

  console.log(`[AliExpress Massive] Found ${sellerUrls.length} unique sellers to expand`);

  // Note: AliExpress API doesn't have a direct "get all products from seller" endpoint
  // In production, this would use alternative methods or scrape
  // For now, return empty and rely on other strategies
  
  return [];
}

/**
 * Main function: Fetch massive pool from AliExpress
 * Combines all strategies to reach 100K+ products
 */
async function fetchMassivePool(keywords, targetSize = 100000) {
  console.log(`\n========================================`);
  console.log(`[AliExpress Massive] Starting fetch for: "${keywords}"`);
  console.log(`[AliExpress Massive] Target pool size: ${targetSize}`);
  console.log(`========================================\n`);

  const startTime = Date.now();
  const seen = new Set();
  const allProducts = [];

  // Strategy 1: Multi-Sort Deep Dive (35K target)
  const multiSortProducts = await fetchMultiSortDeepDive(keywords, 35000);
  for (const product of multiSortProducts) {
    const pid = String(product.productId);
    if (!seen.has(pid)) {
      seen.add(pid);
      allProducts.push(product);
    }
  }
  console.log(`[AliExpress Massive] After Multi-Sort: ${allProducts.length} products\n`);

  // Strategy 2: Query Variations (25K target)
  if (allProducts.length < targetSize * 0.7) {
    const variationProducts = await fetchQueryVariations(keywords, 25000);
    for (const product of variationProducts) {
      const pid = String(product.productId);
      if (!seen.has(pid)) {
        seen.add(pid);
        allProducts.push(product);
      }
    }
    console.log(`[AliExpress Massive] After Query Variations: ${allProducts.length} products\n`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`========================================`);
  console.log(`[AliExpress Massive] COMPLETE:`);
  console.log(`[AliExpress Massive] Total unique products: ${allProducts.length}`);
  console.log(`[AliExpress Massive] Time elapsed: ${Math.round(elapsed / 1000)}s`);
  console.log(`[AliExpress Massive] Target was: ${targetSize}`);
  console.log(`[AliExpress Massive] Achieved: ${Math.round((allProducts.length / targetSize) * 100)}%`);
  console.log(`========================================\n`);

  return allProducts;
}

module.exports = {
  fetchMassivePool,
  fetchMultiSortDeepDive,
  fetchQueryVariations,
  SORT_STRATEGIES
};
