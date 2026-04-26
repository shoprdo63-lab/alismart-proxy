// api/search.js - AliExpress DS Product Search API
// Using aliexpress.ds.product.search for better relevance

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Support both GET and POST
  let body = {};
  if (req.method === 'GET') {
    body = req.query || {};
  } else if (req.method === 'POST') {
    try {
      body = await parseBody(req);
    } catch (e) {
      body = req.body || {};
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    q, 
    keywords,
    keyword,
    page = 1, 
    pageSize = 50, 
    maxResults = 50,
    sort = 'RELEVANCE',
    locale = 'en_US',
    language = 'en',
    currency = 'USD',
    shipToCountry = 'US',
    minPrice,
    maxPrice,
    categoryId
  } = body;

  // Support multiple parameter names for backward compatibility
  const searchQuery = (q || keywords || keyword || '').trim();

  if (!searchQuery) {
    return res.status(400).json({ 
      error: 'Missing search query (q, keywords, or keyword required)',
      success: false 
    });
  }

  try {
    console.log('[Server] Searching for:', searchQuery);

    // קריאה ל-AliExpress Dropshipping API
    const apiUrl = 'https://api.aliexpress.com/v1/aliexpress.ds.product.search';
    
    const requestBody = {
      // פרמטרים חובה
      q: searchQuery,
      
      // פרמטרים אופציונליים
      page: parseInt(page),
      pageSize: Math.min(parseInt(pageSize || maxResults), 50), // מקסימום 50
      
      // מיון - אפשרויות: RELEVANCE, SALE_PRICE_ASC, SALE_PRICE_DESC, LAST_VOLUME_DESC
      sort: sort,
      
      // הגדרות אזוריות
      locale: locale || language || 'en_US',
      currency: currency,
      shipTo: shipToCountry,
      
      // פילטרים נוספים (אופציונלי)
      ...(minPrice && { minPrice: parseFloat(minPrice) }),
      ...(maxPrice && { maxPrice: parseFloat(maxPrice) }),
      ...(categoryId && { categoryId })
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.ALIEXPRESS_TOKEN}`,
        'X-Api-Key': process.env.ALIEXPRESS_APP_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Server] AliExpress API error:', response.status, errorText);
      throw new Error(`AliExpress API error: ${response.status}`);
    }

    const data = await response.json();
    
    // עיבוד התוצאות
    const products = data.data?.products || [];
    const totalCount = data.data?.totalCount || 0;
    
    console.log(`[Server] Found ${products.length} products out of ${totalCount}`);

    // Generate affiliate links
    const trackingId = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';

    // החזרת תוצאות בפורמט שהתוסף מצפה לו
    const formattedProducts = products.map(p => {
      const productId = p.productId;
      const productUrl = p.productDetailUrl || `https://www.aliexpress.com/item/${productId}.html`;
      const affiliateLink = `https://s.click.aliexpress.com/deep_link.htm?aff_short_key=${trackingId}&dl_target_url=${encodeURIComponent(productUrl)}`;
      
      return {
        productId: productId,
        title: p.subject || p.title || '',
        price: p.salePrice?.amount || p.price || '0',
        originalPrice: p.originalPrice?.amount || p.price || '0',
        priceNumeric: parseFloat(p.salePrice?.amount || p.price || '0'),
        currency: p.salePrice?.currency || currency,
        imgUrl: p.productMainImage || p.imageUrl || '',
        imageUrl: p.productMainImage || p.imageUrl || '', // for extension compatibility
        productUrl: productUrl,
        affiliateLink: affiliateLink,
        rating: p.evaluationRating || 0,
        totalSales: p.orders || 0,
        storeName: p.storeName || 'AliExpress Store',
        storeId: p.storeId || '',
        storeUrl: p.storeId ? `https://www.aliexpress.com/store/${p.storeId}` : '',
        discountPct: calculateDiscount(p.originalPrice?.amount, p.salePrice?.amount),
        shipping: {
          free: p.shippingFee?.freeShipping || false,
          cost: p.shippingFee?.amount || 0
        }
      };
    });

    res.status(200).json({
      success: true,
      count: formattedProducts.length,
      products: formattedProducts,
      totalCount: totalCount,
      page: parseInt(page),
      pageSize: parseInt(pageSize || maxResults),
      query: searchQuery,
      language: locale || language || 'en',
      currency: currency,
      candidatePoolSize: totalCount,
      executionTimeMs: 0
    });

  } catch (error) {
    console.error('[Server] Error:', error.message);
    
    res.status(500).json({ 
      error: error.message,
      success: false,
      products: [],
      count: 0
    });
  }
}

// Parse POST body
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Calculate discount percentage
function calculateDiscount(original, sale) {
  const orig = parseFloat(original || 0);
  const salePrice = parseFloat(sale || 0);
  if (orig > 0 && salePrice > 0 && orig > salePrice) {
    return Math.round((1 - salePrice / orig) * 100);
  }
  return 0;
}
