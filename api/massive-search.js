const { analyzeNiche } = require('../services/analytics.js');
const cache = require('../services/cache.js');
const { minifyResponse, shouldMinify, calculateSavings } = require('../services/json-minify.js');

// AliExpress Massive Search System
const { fetchMassivePool } = require('../services/aliexpress-massive.js');
const { scoreProductPool } = require('../services/aliexpress-scoring.js');
const { selectTopProducts } = require('../services/smart-selection.js');

const AFFILIATE_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const MAX_RESULTS = 1000;

function applyCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

/**
 * MASSIVE SEARCH HANDLER
 * AliExpress-only: 20K pool → Top 1K selection
 * Professional sourcing intelligence optimized for Vercel
 * 10 strategies × 50 pages = up to 50K potential, ~20K unique
 */
module.exports = async function handler(req, res) {
  applyCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const executionStart = Date.now();
  const { q, limit = 1000, poolSize = 20000, minimal = 'false' } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Query parameter "q" is required'
    });
  }

  const cacheKey = `massive:${q}:${poolSize}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('[Massive Search] Cache hit for:', q);
    return res.status(200).json({ ...cached, cached: true });
  }

  try {
    console.log('\n🚀 ============================================');
    console.log(`🚀 MASSIVE SEARCH STARTED: "${q}"`);
    console.log(`🚀 Pool Target: ${poolSize} | Final Target: ${limit}`);
    console.log('🚀 ============================================\n');

    // Stage 1: Fetch massive pool from AliExpress
    console.log('[Stage 1/4] Fetching massive pool...');
    const poolStart = Date.now();
    const rawPool = await fetchMassivePool(q, parseInt(poolSize));
    const poolTime = Date.now() - poolStart;
    
    console.log(`✅ Pool fetched: ${rawPool.length} products in ${Math.round(poolTime/1000)}s\n`);

    // Stage 2: Score all products
    console.log('[Stage 2/4] Scoring product pool...');
    const scoreStart = Date.now();
    const scoredPool = scoreProductPool(rawPool);
    const scoreTime = Date.now() - scoreStart;
    
    console.log(`✅ Pool scored: ${scoredPool.length} products in ${Math.round(scoreTime/1000)}s\n`);

    // Stage 3: Smart selection of top 1K
    console.log('[Stage 3/4] Smart selection...');
    const selectStart = Date.now();
    const { products: selectedProducts, stats } = selectTopProducts(scoredPool, parseInt(limit));
    const selectTime = Date.now() - selectStart;
    
    console.log(`✅ Selected: ${selectedProducts.length} products in ${Math.round(selectTime/1000)}s\n`);

    // Stage 4: Enrich final products
    console.log('[Stage 4/4] Final enrichment...');
    const enrichStart = Date.now();
    const { enrichedProducts } = analyzeNiche(selectedProducts, q);
    const enrichTime = Date.now() - enrichStart;
    
    // Add affiliate links and normalize
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
      compositeScore: p.compositeScore || 0,
      priceScore: p.priceScore || 0,
      qualityScore: p.qualityScore || 0,
      velocityScore: p.velocityScore || 0,
      sellerScore: p.sellerScore || 0,
      shippingScore: p.shippingScore || 0
    }));

    const totalTime = Date.now() - executionStart;

    console.log('\n🎯 ============================================');
    console.log(`🎯 MASSIVE SEARCH COMPLETE: "${q}"`);
    console.log(`🎯 Final Results: ${finalProducts.length} products`);
    console.log(`🎯 Total Time: ${Math.round(totalTime/1000)}s`);
    console.log(`🎯 Pool Size: ${rawPool.length} → Quality: ${scoredPool.length} → Final: ${finalProducts.length}`);
    console.log(`🎯 Selection Rate: ${stats.selectionRate}%`);
    console.log('🎯 ============================================\n');

    const response = {
      success: true,
      products: finalProducts,
      data: finalProducts,
      count: finalProducts.length,
      query: q,
      mode: 'massive',
      stats: {
        poolSize: rawPool.length,
        qualityCount: scoredPool.length,
        selectionRate: stats.selectionRate,
        timing: {
          poolFetch: poolTime,
          scoring: scoreTime,
          selection: selectTime,
          enrichment: enrichTime,
          total: totalTime
        },
        quality: stats.quality,
        diversity: stats.diversity
      },
      executionTimeMs: totalTime,
      cached: false
    };

    // JSON minification if needed
    if (shouldMinify(finalProducts.length) || minimal === 'true') {
      const minifyStart = Date.now();
      const minifiedPayload = minifyResponse(response, minimal === 'true');
      const savings = calculateSavings(response, minifiedPayload);
      console.log(`[Massive Search] JSON Minification: ${savings.originalBytes} → ${savings.minifiedBytes} bytes (${savings.ratio} saved)`);
      
      cache.set(cacheKey, minifiedPayload, 7200);
      return res.status(200).json(minifiedPayload);
    }

    // Cache for 2 hours
    cache.set(cacheKey, response, 7200);

    return res.status(200).json(response);

  } catch (error) {
    console.error('[Massive Search] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Massive search failed',
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
