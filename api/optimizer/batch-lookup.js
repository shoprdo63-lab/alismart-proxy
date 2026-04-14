/**
 * Batch Product Lookup Endpoint
 * POST /api/optimizer/batch-lookup
 *
 * Efficiently fetches product details for multiple IDs (5-15 items typical cart)
 * Returns enriched data including packageWeight and categoryId for Tax Engine
 */

const { getProductDetails } = require('../../services/aliexpress.js');
const { filterProducts } = require('../../services/content-filter.js');
const cache = require('../../services/cache.js');

const MAX_BATCH_SIZE = 20;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for cart data

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

function normalizeImageUrl(url) {
  if (!url) return '';
  let normalized = String(url);
  if (normalized.startsWith('//')) normalized = 'https:' + normalized;
  if (normalized.startsWith('http://')) normalized = normalized.replace('http://', 'https://');
  return normalized;
}

module.exports = async function handler(req, res) {
  applyCORS(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ success: true, products: [], count: 0 });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ success: true, products: [], count: 0 });
  }

  const executionStart = Date.now();

  try {
    // Parse request body
    const { productIds, targetCurrency, destinationCountry } = req.body || {};

    // Validate productIds
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'productIds array is required',
        products: [],
        count: 0
      });
    }

    if (productIds.length > MAX_BATCH_SIZE) {
      return res.status(200).json({
        success: false,
        error: `Maximum ${MAX_BATCH_SIZE} products per batch`,
        products: [],
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
        products: [],
        count: 0
      });
    }

    console.log(`[BatchLookup] Processing ${sanitizedIds.length} product IDs`);

    // Generate cache key
    const cacheKey = cache.cacheKey('batch', sanitizedIds.sort().join(','));
    const cached = cache.get(cacheKey);

    if (cached) {
      const executionTimeMs = Date.now() - executionStart;
      console.log(`[BatchLookup] Cache HIT - ${cached.count} products in ${executionTimeMs}ms`);
      return res.status(200).json({ ...cached, cached: true, executionTimeMs });
    }

    // Fetch product details
    const rawProducts = await getProductDetails(sanitizedIds);

    if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
      return res.status(200).json({
        success: true,
        products: [],
        count: 0,
        executionTimeMs: Date.now() - executionStart,
        cached: false
      });
    }

    // Apply content filter (The Shield) - remove inappropriate items
    const { filtered, blockedCount } = filterProducts(rawProducts);

    if (blockedCount > 0) {
      console.log(`[BatchLookup] Content filter blocked ${blockedCount} items`);
    }

    // Normalize and structure response
    const products = filtered.map(product => ({
      productId: String(product.productId || ''),
      title: String(product.title || '').substring(0, 200),
      price: String(product.price || ''),
      imgUrl: normalizeImageUrl(product.productImage || product.imageUrl || ''),
      affiliateLink: String(product.affiliateLink || product.productUrl || ''),
      packageWeight: product.packageWeight || null,
      categoryId: String(product.categoryId || ''),
      storeUrl: String(product.storeUrl || ''),
      shippingCost: product.shippingCost || 0,
      rating: product.rating || null,
      totalSales: product.totalSales || 0,
      discountPct: product.discountPct || 0
    }));

    const executionTimeMs = Date.now() - executionStart;

    const responsePayload = {
      success: true,
      products,
      count: products.length,
      targetCurrency: targetCurrency || 'USD',
      destinationCountry: destinationCountry || '',
      executionTimeMs,
      cached: false
    };

    // Cache for 5 minutes
    cache.set(cacheKey, responsePayload, CACHE_TTL_MS);

    console.log(`[BatchLookup] Completed: ${products.length} products in ${executionTimeMs}ms`);

    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error('[BatchLookup] Fatal error:', error?.message || 'Unknown');
    return res.status(200).json({
      success: false,
      error: 'Batch lookup failed',
      products: [],
      count: 0,
      executionTimeMs: Date.now() - executionStart
    });
  }
};
