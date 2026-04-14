/**
 * Bundle Discovery Endpoint
 * POST /api/optimizer/bundles
 *
 * Finds "Super-Sellers" and AliExpress Choice stores that carry multiple items from cart
 * Enables bundle shipping optimization (lower combined shipping costs)
 */

const { findAlternativeSellers } = require('../../services/aliexpress.js');
const { filterProducts } = require('../../services/content-filter.js');
const cache = require('../../services/cache.js');

const MAX_CART_SIZE = 20;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function applyCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

function sanitizeProductId(id) {
  if (!id || typeof id !== 'string') return null;
  const cleaned = id.replace(/\D/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

module.exports = async function handler(req, res) {
  applyCORS(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ success: true, bundles: [], count: 0 });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ success: true, bundles: [], count: 0 });
  }

  const executionStart = Date.now();

  try {
    const { productIds, minMatchCount = 2, prioritizeChoice = true } = req.body || {};

    // Validation
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'productIds array is required',
        bundles: [],
        count: 0
      });
    }

    if (productIds.length > MAX_CART_SIZE) {
      return res.status(200).json({
        success: false,
        error: `Maximum ${MAX_CART_SIZE} products per cart`,
        bundles: [],
        count: 0
      });
    }

    // Sanitize IDs
    const sanitizedIds = productIds
      .map(id => sanitizeProductId(id))
      .filter(id => id !== null);

    if (sanitizedIds.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'No valid product IDs provided',
        bundles: [],
        count: 0
      });
    }

    console.log(`[Bundles] Analyzing ${sanitizedIds.length} cart items for bundle opportunities`);

    // Cache key
    const cacheKey = cache.cacheKey('bundles', sanitizedIds.sort().join(','), String(minMatchCount));
    const cached = cache.get(cacheKey);

    if (cached) {
      const executionTimeMs = Date.now() - executionStart;
      console.log(`[Bundles] Cache HIT - ${cached.count} bundles in ${executionTimeMs}ms`);
      return res.status(200).json({ ...cached, cached: true, executionTimeMs });
    }

    // Find alternative sellers with bundle opportunities
    // Pass content filter function (The Shield)
    const rawBundles = await findAlternativeSellers(sanitizedIds, filterProducts);

    // Apply minMatchCount filter if specified
    let bundles = rawBundles;
    if (minMatchCount && minMatchCount > 2) {
      bundles = bundles.filter(b => b.matchCount >= minMatchCount);
    }

    // Apply Choice prioritization if requested
    if (prioritizeChoice) {
      bundles = bundles.sort((a, b) => {
        // First: match count
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        // Second: Choice status (Choice stores first)
        if (b.isChoiceStore !== a.isChoiceStore) return b.isChoiceStore ? 1 : -1;
        // Third: rating
        return b.avgRating - a.avgRating;
      });
    }

    // Calculate potential savings summary
    const bundleSummary = bundles.map(bundle => ({
      storeId: bundle.storeId,
      storeName: bundle.storeName,
      storeUrl: bundle.storeUrl,
      matchCount: bundle.matchCount,
      isChoiceStore: bundle.isChoiceStore,
      avgRating: bundle.avgRating,
      products: bundle.products.map(p => ({
        originalId: p.originalProductId,
        alternativeId: p.alternativeProductId,
        title: p.alternativeTitle?.substring(0, 100),
        price: p.alternativePrice,
        image: p.alternativeImage
      }))
    }));

    const executionTimeMs = Date.now() - executionStart;

    const responsePayload = {
      success: true,
      bundles: bundleSummary,
      count: bundleSummary.length,
      cartSize: sanitizedIds.length,
      potentialSavings: bundleSummary.length > 0 ? {
        singleStoreOptions: bundleSummary.length,
        bestMatchStore: bundleSummary[0]?.storeName || null,
        maxItemsFromSingleStore: Math.max(...bundleSummary.map(b => b.matchCount), 0)
      } : null,
      executionTimeMs,
      cached: false
    };

    // Cache results
    cache.set(cacheKey, responsePayload, CACHE_TTL_MS);

    console.log(`[Bundles] Completed: ${bundleSummary.length} bundles found in ${executionTimeMs}ms`);

    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error('[Bundles] Fatal error:', error?.message || 'Unknown');
    return res.status(200).json({
      success: false,
      error: 'Bundle discovery failed',
      bundles: [],
      count: 0,
      executionTimeMs: Date.now() - executionStart
    });
  }
};
