/**
 * Bundle Finder Service
 *
 * Finds if cart items exist under the same store/seller
 * Enables bundle shipping optimization and combined checkout
 */

const { searchByProductId } = require('./aliexpress.js');
const { filterProducts } = require('./content-filter.js');

/**
 * Generate unique bundle ID from store ID and product count
 */
function generateBundleId(storeId, productCount) {
  const timestamp = Date.now().toString(36).slice(-4);
  return `BND-${storeId}-${productCount}-${timestamp}`;
}

/**
 * Find bundles - items from cart that exist under same store
 *
 * @param {string[]} productIds - Cart product IDs
 * @returns {Promise<Object>} Bundle analysis with bundleId assignments
 */
async function findBundles(productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return { bundles: [], singleItems: [], totalBundles: 0 };
  }

  console.log(`[BundleFinder] Analyzing ${productIds.length} cart items for bundle opportunities`);
  const startTime = Date.now();

  // Map to track which original products were found at which stores
  const storeProductMap = new Map(); // storeId -> { products: [], isChoiceCount, superSellerScore }
  const productStoreMap = new Map(); // productId -> [{ storeId, alternativeProduct, isChoice }]

  // Search for alternatives for each cart item
  const searchPromises = productIds.map(async (originalId) => {
    try {
      const alternatives = await searchByProductId(originalId);
      return { originalId, alternatives: alternatives || [] };
    } catch (error) {
      console.error(`[BundleFinder] Error searching for ${originalId}:`, error.message);
      return { originalId, alternatives: [] };
    }
  });

  const searchResults = await Promise.all(searchPromises);

  // Build store-to-products mapping
  for (const { originalId, alternatives } of searchResults) {
    if (!Array.isArray(alternatives) || alternatives.length === 0) {
      continue;
    }

    // Track all store options for this product
    const storeOptions = [];

    for (const alt of alternatives) {
      const storeId = extractStoreId(alt.storeUrl);
      if (!storeId) continue;

      // Initialize store entry
      if (!storeProductMap.has(storeId)) {
        storeProductMap.set(storeId, {
          storeId,
          storeUrl: alt.storeUrl || '',
          storeName: alt.storeName || `Store ${storeId}`,
          products: [],
          isChoiceCount: 0,
          superSellerIndicators: 0
        });
      }

      const storeEntry = storeProductMap.get(storeId);

      // Check if we already added this product to this store
      const existingIndex = storeEntry.products.findIndex(p => p.originalId === originalId);

      if (existingIndex === -1) {
        // Add new product to store
        const productEntry = {
          originalId,
          alternativeId: alt.productId,
          title: alt.title || '',
          price: alt.price || '',
          image: alt.productImage || '',
          isChoice: alt.isChoiceItem || false,
          rating: alt.rating || 0
        };

        storeEntry.products.push(productEntry);

        if (alt.isChoiceItem) {
          storeEntry.isChoiceCount++;
        }

        // Super-seller indicators
        if (alt.rating >= 4.5) storeEntry.superSellerIndicators++;
        if (alt.totalSales > 1000) storeEntry.superSellerIndicators++;
      }

      storeOptions.push({
        storeId,
        alternativeProduct: alt,
        isChoice: alt.isChoiceItem || false
      });
    }

    productStoreMap.set(originalId, storeOptions);
  }

  // Find stores with 2+ products (real bundles)
  const bundles = [];
  const singleItems = [];

  for (const storeEntry of storeProductMap.values()) {
    if (storeEntry.products.length >= 2) {
      // Calculate bundle quality score
      const choiceRatio = storeEntry.isChoiceCount / storeEntry.products.length;
      const isSuperSeller = storeEntry.superSellerIndicators >= (storeEntry.products.length * 1.5);

      // Priority scoring for sorting
      const priorityScore = (storeEntry.products.length * 10) +
                           (choiceRatio * 5) +
                           (isSuperSeller ? 3 : 0);

      const bundle = {
        bundleId: generateBundleId(storeEntry.storeId, storeEntry.products.length),
        storeId: storeEntry.storeId,
        storeName: storeEntry.storeName,
        storeUrl: storeEntry.storeUrl,
        productCount: storeEntry.products.length,
        isChoiceStore: choiceRatio > 0.5,
        isSuperSeller: isSuperSeller,
        priorityScore: priorityScore,
        products: storeEntry.products,
        estimatedSavings: calculateEstimatedSavings(storeEntry.products.length)
      };

      bundles.push(bundle);
    }
  }

  // Sort bundles by priority (best first)
  bundles.sort((a, b) => b.priorityScore - a.priorityScore);

  // Find single items (products not in any bundle)
  const bundledProductIds = new Set();
  for (const bundle of bundles) {
    for (const product of bundle.products) {
      bundledProductIds.add(product.originalId);
    }
  }

  for (const { originalId, alternatives } of searchResults) {
    if (!bundledProductIds.has(originalId) && alternatives.length > 0) {
      // Get best single option (prioritize Choice, then rating)
      const bestOption = alternatives.sort((a, b) => {
        if (b.isChoiceItem !== a.isChoiceItem) return b.isChoiceItem ? 1 : -1;
        return (b.rating || 0) - (a.rating || 0);
      })[0];

      singleItems.push({
        originalId,
        bestAlternative: {
          productId: bestOption.productId,
          storeId: extractStoreId(bestOption.storeUrl),
          storeName: bestOption.storeName || extractStoreId(bestOption.storeUrl),
          title: bestOption.title,
          price: bestOption.price,
          image: bestOption.productImage,
          isChoice: bestOption.isChoiceItem || false,
          rating: bestOption.rating || 0
        }
      });
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[BundleFinder] Found ${bundles.length} bundles, ${singleItems.length} single items in ${elapsed}ms`);

  // Log bundle summary
  for (const bundle of bundles) {
    console.log(`  [Bundle ${bundle.bundleId}] ${bundle.storeName}: ${bundle.productCount} products, Choice: ${bundle.isChoiceStore}, Score: ${bundle.priorityScore}`);
  }

  return {
    bundles,
    singleItems,
    totalBundles: bundles.length,
    totalSingleItems: singleItems.length,
    canBundleAll: bundles.length === 1 && bundles[0].productCount === productIds.length,
    bestBundle: bundles[0] || null
  };
}

/**
 * Extract store ID from URL
 */
function extractStoreId(storeUrl) {
  if (!storeUrl || typeof storeUrl !== 'string') return null;
  const match = storeUrl.match(/\/store\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Estimate shipping savings from bundling
 */
function calculateEstimatedSavings(itemCount) {
  // Rough estimate: bundling 2 items saves ~30%, 3+ saves ~40%
  if (itemCount === 2) return 30;
  if (itemCount >= 3) return 40;
  return 0;
}

/**
 * Assign bundle IDs to products for batch-lookup response
 */
function assignBundleIds(products, bundleAnalysis) {
  if (!Array.isArray(products) || !bundleAnalysis || !bundleAnalysis.bundles) {
    return products.map(p => ({ ...p, bundleId: null }));
  }

  // Create product-to-bundleId mapping
  const productBundleMap = new Map();

  for (const bundle of bundleAnalysis.bundles) {
    for (const product of bundle.products) {
      productBundleMap.set(product.originalId, bundle.bundleId);
    }
  }

  // Assign bundleId to each product
  return products.map(product => ({
    ...product,
    bundleId: productBundleMap.get(product.productId) || null
  }));
}

module.exports = {
  findBundles,
  assignBundleIds,
  generateBundleId
};
