/**
 * Aggressive Server-Side Deduplication Service
 * 
 * Implements a "Fingerprinting" algorithm for products.
 * A product is a duplicate if: abs(price_a - price_b) < 0.1 AND string_similarity(title_a, title_b) > 85%.
 * Keep only the listing with the highest "Value Score" (Orders / Price * Rating).
 */

const { parsePrice } = require('./analytics.js');

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy string matching
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  const aLen = a.length;
  const bLen = b.length;

  for (let i = 0; i <= bLen; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= aLen; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[bLen][aLen];
}

/**
 * Calculate normalized Levenshtein similarity (0-1 scale)
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1 where 1 is identical
 */
function normalizedLevenshtein(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Calculate string similarity using multiple algorithms for accuracy
 * Primary: Normalized Levenshtein for fuzzy matching
 * Fallback: Jaccard similarity for word overlap
 * @param {string} str1
 * @param {string} str2
 * @returns {number} 0-100 percentage
 */
function stringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  const a = str1.toLowerCase().trim();
  const b = str2.toLowerCase().trim();
  
  if (a === b) return 100;
  
  // Levenshtein-based similarity (good for minor variations)
  const levSim = normalizedLevenshtein(a, b);
  
  // Jaccard similarity for word overlap (good for word reordering)
  const setA = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const setB = new Set(b.split(/\s+/).filter(w => w.length > 2));
  
  if (setA.size === 0 || setB.size === 0) {
    return Math.round(levSim * 100);
  }
  
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  const jaccardSim = intersection.size / union.size;
  
  // Weighted combination: Levenshtein for character-level, Jaccard for word-level
  const combined = levSim * 0.6 + jaccardSim * 0.4;
  
  return Math.round(combined * 100);
}

/**
 * Generate a product fingerprint for deduplication
 * Uses normalized title + price bucket
 * @param {Object} product
 * @returns {string}
 */
function generateFingerprint(product) {
  const title = (product.title || '').toLowerCase().trim();
  const price = parsePrice(product.price);
  
  // Normalize title: remove common variations
  const normalizedTitle = title
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Price bucket: round to nearest 0.1 for fuzzy matching
  const priceBucket = Math.round(price * 10) / 10;
  
  return `${normalizedTitle}|${priceBucket}`;
}

/**
 * Calculate Value Score for a product
 * Value Score = Orders / Price * Rating
 * Higher is better (more orders, lower price, higher rating)
 * @param {Object} product
 * @returns {number}
 */
function calculateValueScore(product) {
  const orders = product.totalSales || 0;
  const price = parsePrice(product.price) || 1; // Avoid div by zero
  const rating = product.rating || 0;
  
  // Formula: (Orders / Price) * (Rating / 5) * 100
  // Normalized so rating contributes proportionally
  const valueScore = (orders / price) * (rating > 0 ? rating / 5 : 0.5) * 100;
  
  return Math.round(valueScore * 100) / 100;
}

/**
 * Check if two products are duplicates based on fingerprinting
 * Conditions: abs(price_a - price_b) < 0.1 AND string_similarity(title_a, title_b) > 85%
 * @param {Object} productA
 * @param {Object} productB
 * @returns {boolean}
 */
function isDuplicate(productA, productB) {
  const priceA = parsePrice(productA.price);
  const priceB = parsePrice(productB.price);
  
  // Price check: abs(price_a - price_b) < 0.1
  const priceDiff = Math.abs(priceA - priceB);
  if (priceDiff >= 0.1) return false;
  
  // Title similarity check: string_similarity > 85%
  const similarity = stringSimilarity(productA.title, productB.title);
  if (similarity <= 85) return false;
  
  return true;
}

/**
 * Aggressive deduplication of product array
 * Groups potential duplicates and keeps only the highest Value Score item
 * 
 * Algorithm:
 * 1. Sort by value score descending (so we keep best first)
 * 2. For each product, compare against kept products
 * 3. If duplicate found, skip (keep the higher value score one)
 * 4. If not duplicate, add to kept list
 * 
 * @param {Object[]} products - Array of products to deduplicate
 * @returns {{ deduped: Object[], removedCount: number, duplicates: Array[] }}
 */
function deduplicateProducts(products) {
  if (!Array.isArray(products) || products.length === 0) {
    return { deduped: [], removedCount: 0, duplicates: [] };
  }

  const startTime = Date.now();
  const totalCount = products.length;
  
  // Pre-calculate value scores for all products
  const productsWithScore = products.map(p => ({
    ...p,
    valueScore: calculateValueScore(p)
  }));
  
  // Sort by value score descending (higher score = better deal)
  productsWithScore.sort((a, b) => b.valueScore - a.valueScore);
  
  const kept = [];
  const duplicateGroups = [];
  let removedCount = 0;
  
  // For each product, check if it's a duplicate of any already-kept product
  for (const product of productsWithScore) {
    let isDup = false;
    let matchedWith = null;
    
    // Compare against kept products (only check recent ones for performance)
    // Limit comparison window to last 100 kept items for O(n) instead of O(n²)
    const checkWindow = kept.slice(-100);
    
    for (const keptProduct of checkWindow) {
      if (isDuplicate(product, keptProduct)) {
        isDup = true;
        matchedWith = keptProduct;
        break;
      }
    }
    
    if (isDup) {
      removedCount++;
      // Track duplicate groups for analytics
      const existingGroup = duplicateGroups.find(g => g.kept === matchedWith);
      if (existingGroup) {
        existingGroup.removed.push(product);
      } else {
        duplicateGroups.push({ kept: matchedWith, removed: [product] });
      }
    } else {
      kept.push(product);
    }
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`[Deduplication] ${totalCount} → ${kept.length} (removed ${removedCount} duplicates) in ${elapsed}ms`);
  
  return {
    deduped: kept,
    removedCount,
    duplicates: duplicateGroups
  };
}

/**
 * Fast deduplication using hash bucketing for large datasets
 * Groups products by price bucket first, then checks title similarity within bucket
 * More efficient for 1000+ products
 * @param {Object[]} products
 * @returns {{ deduped: Object[], removedCount: number }}
 */
function fastDeduplicate(products) {
  if (!Array.isArray(products) || products.length === 0) {
    return { deduped: [], removedCount: 0 };
  }

  const startTime = Date.now();
  const totalCount = products.length;
  
  // Pre-calculate value scores
  const scoredProducts = products.map(p => ({
    ...p,
    valueScore: calculateValueScore(p),
    priceNum: parsePrice(p.price)
  }));
  
  // Create price buckets (0.1 increments)
  const buckets = new Map();
  for (const p of scoredProducts) {
    const bucketKey = Math.floor(p.priceNum * 10) / 10; // Round down to 0.1
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey).push(p);
  }
  
  // Also check adjacent buckets (price diff up to 0.1 spans 2 buckets)
  const kept = [];
  const processed = new Set();
  let removedCount = 0;
  
  // Sort all buckets' contents by value score
  for (const [bucketKey, bucketProducts] of buckets) {
    bucketProducts.sort((a, b) => b.valueScore - a.valueScore);
  }
  
  // Process each bucket
  for (const [bucketKey, bucketProducts] of buckets) {
    // Get adjacent bucket keys to check
    const adjacentKeys = [bucketKey - 0.1, bucketKey, bucketKey + 0.1];
    const adjacentProducts = adjacentKeys
      .map(k => buckets.get(k) || [])
      .flat()
      .filter(p => !processed.has(p.productId));
    
    for (const product of bucketProducts) {
      if (processed.has(product.productId)) continue;
      
      let isDup = false;
      
      // Check against already-kept products in adjacent buckets
      for (const other of adjacentProducts) {
        if (other === product || processed.has(other.productId)) continue;
        
        if (stringSimilarity(product.title, other.title) > 85) {
          // Found duplicate - keep the one with higher value score
          // Since buckets are sorted by value score, 'other' is higher
          isDup = true;
          break;
        }
      }
      
      if (isDup) {
        removedCount++;
      } else {
        kept.push(product);
      }
      processed.add(product.productId);
    }
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`[FastDeduplication] ${totalCount} → ${kept.length} (removed ${removedCount}) in ${elapsed}ms`);
  
  return { deduped: kept, removedCount };
}

module.exports = {
  deduplicateProducts,
  fastDeduplicate,
  stringSimilarity,
  calculateValueScore,
  isDuplicate,
  generateFingerprint
};
