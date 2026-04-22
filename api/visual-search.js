const { analyzeNiche } = require('../services/analytics.js');
const cache = require('../services/cache.js');
const { minifyResponse, shouldMinify, calculateSavings } = require('../services/json-minify.js');
const { visualSearchEnhanced } = require('../services/visual-search-enhanced.js');

const AFFILIATE_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';

function applyCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

/**
 * VISUAL SEARCH HANDLER
 * AliPrice-style visual search using AliExpress
 * Returns visually similar products with price comparison
 */
module.exports = async function handler(req, res) {
  applyCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const executionStart = Date.now();
  const { 
    imageUrl, 
    limit = 50, 
    minimal = 'false',
    expandSearch = 'true',
    includeHot = 'true',
    includePromo = 'true',
    locale = 'en',
    skipCache = 'false'
  } = req.query;

  if (!imageUrl || !imageUrl.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Query parameter "imageUrl" is required'
    });
  }

  const cacheKey = `visual:${imageUrl}:${limit}:${expandSearch}:${locale}`;
  
  if (skipCache !== 'true') {
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[Visual Search] Cache hit for: ${imageUrl.substring(0, 50)} (locale: ${locale})`);
      return res.status(200).json({ ...cached, cached: true });
    }
  } else {
    console.log(`[Visual Search] Cache skipped (skipCache=true) for: ${imageUrl.substring(0, 50)}`);
  }

  try {
    console.log('\n🖼️ ============================================');
    console.log(`🖼️ VISUAL SEARCH STARTED`);
    console.log(`🖼️ Image: ${imageUrl.substring(0, 60)}...`);
    console.log(`🖼️ Target: ${limit} results`);
    console.log(`🖼️ Locale: ${locale}`);
    console.log('🖼️ ============================================\n');

    // Perform enhanced visual search with locale support
    const searchStart = Date.now();
    const { 
      products: visualProducts, 
      clusters, 
      stats,
      sourceContext 
    } = await visualSearchEnhanced(imageUrl, {
      targetResults: parseInt(limit),
      expandWithKeywords: expandSearch === 'true',
      includeHotProducts: includeHot === 'true',
      includePromoProducts: includePromo === 'true',
      locale: locale
    });
    const searchTime = Date.now() - searchStart;

    // Enrich products
    console.log('[Visual Search] Enriching products...');
    const { enrichedProducts } = analyzeNiche(visualProducts, '');

    // Add affiliate links
    const finalProducts = enrichedProducts.map(p => ({
      productId: String(p.productId || ''),
      title: String(p.title || '').substring(0, 200),
      price: String(p.price || ''),
      originalPrice: String(p.originalPrice || ''),
      discountPct: p.discountPct || 0,
      imgUrl: normalizeImageUrl(p.productImage || p.imageUrl || ''),
      productUrl: String(p.itemUrl || ''),
      affiliateLink: String(p.affiliateLink || p.itemUrl || ''),
      rating: p.rating || null,
      totalSales: p.totalSales || 0,
      storeUrl: String(p.storeUrl || ''),
      storeName: String(p.storeName || ''),
      isChoiceItem: p.isChoiceItem || false,
      isHotProduct: p.isHotProduct || false,
      isPromoProduct: p.isPromoProduct || false,
      // Visual search specific
      visualMatchScore: p.visualMatchScore || 0,
      clusterId: p.clusterId || '',
      clusterSize: p.clusterSize || 1,
      similarProductsCount: p.similarProductsCount || 0,
      priceRange: p.priceRange || null,
      isAlternative: p.isAlternative || false,
      source: p.source || 'unknown'
    }));

    const totalTime = Date.now() - executionStart;

    console.log('\n✅ ============================================');
    console.log(`✅ VISUAL SEARCH COMPLETE`);
    console.log(`✅ Results: ${finalProducts.length} products`);
    console.log(`✅ Clusters: ${clusters.length}`);
    console.log(`✅ Time: ${Math.round(totalTime/1000)}s`);
    console.log('✅ ============================================\n');

    const response = {
      success: true,
      products: finalProducts,
      data: finalProducts,
      count: finalProducts.length,
      imageUrl: imageUrl,
      locale: locale,
      mode: 'visual-search',
      stats: {
        totalScanned: stats.totalScanned,
        clustersFound: stats.clustersFound,
        sources: stats.sources,
        timing: {
          search: searchTime,
          total: totalTime
        }
      },
      clusters: clusters.slice(0, 10), // Show top 10 clusters
      executionTimeMs: totalTime,
      cached: false
    };

    // JSON minification if needed
    if (shouldMinify(finalProducts.length) || minimal === 'true') {
      const minifyStart = Date.now();
      const minifiedPayload = minifyResponse(response, minimal === 'true');
      const savings = calculateSavings(response, minifiedPayload);
      console.log(`[Visual Search] JSON Minification: ${savings.originalBytes} → ${savings.minifiedBytes} bytes (${savings.ratio} saved)`);
      
      cache.set(cacheKey, minifiedPayload, 3600); // 1 hour cache
      return res.status(200).json(minifiedPayload);
    }

    // Cache for 1 hour
    cache.set(cacheKey, response, 3600);

    return res.status(200).json(response);

  } catch (error) {
    console.error('[Visual Search] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Visual search failed',
      message: error.message
    });
  }
};

function normalizeImageUrl(url) {
  if (!url) return '';
  let normalized = String(url);
  if (normalized.startsWith('//')) normalized = 'https:' + normalized;
  if (normalized.startsWith('http://')) normalized = normalized.replace('http://', 'https://');
  return normalized;
}
