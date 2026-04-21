const axios = require('axios');
const crypto = require('crypto');
const { getProductDetails, searchByKeywords } = require('./aliexpress.js');
const { getHotProducts, getFeaturedPromoProducts } = require('./advanced-ali-api.js');

const APP_KEY = process.env.ALI_APP_KEY || '528438';
const APP_SECRET = process.env.ALI_APP_SECRET || 'YPhzjbGESFs75SniEK0t1wwfKhvrKIhq';

/**
 * Enhanced Visual Search - AliPrice Style
 * 
 * Strategy:
 * 1. Get initial visual matches from AliExpress (scraping)
 * 2. Extract product details and keywords
 * 3. Expand search using Advanced API (hot products, promos)
 * 4. Cluster similar products by visual similarity
 * 5. Return best deals from each cluster
 */

/**
 * Main visual search function
 * @param {string} imageUrl - Image URL to search
 * @param {Object} options - Search options
 * @param {number} options.targetResults - Number of results to return
 * @param {boolean} options.expandWithKeywords - Whether to expand search with keywords
 * @param {boolean} options.includeHotProducts - Include hot products
 * @param {boolean} options.includePromoProducts - Include promo products
 * @param {number} options.similarityThreshold - Similarity threshold for clustering
 * @param {string} options.locale - User locale (e.g., 'en', 'es', 'fr', 'he')
 */
async function visualSearchEnhanced(imageUrl, options = {}) {
  console.log(`\n🔍 [Visual Search] Starting for: ${imageUrl.substring(0, 60)}...`);
  console.log(`🔍 [Visual Search] Locale: ${options.locale || 'en'}`);
  
  const {
    targetResults = 50,
    expandWithKeywords = true,
    includeHotProducts = true,
    includePromoProducts = true,
    similarityThreshold = 0.85,
    locale = 'en'
  } = options;

  const allProducts = [];
  const seenIds = new Set();
  const sourceContext = {
    imageUrl,
    referenceTitles: [],
    referenceCategories: [],
    avgPrice: 0
  };

  // Stage 1: Initial Visual Search (from AliExpress scraping)
  console.log('[Visual Search] Stage 1: Getting initial visual matches...');
  const visualResults = await getVisualMatchesFromAliExpress(imageUrl, locale);
  
  if (visualResults.length === 0) {
    console.log('[Visual Search] No visual matches found');
    return { products: [], clusters: [], sourceContext };
  }

  console.log(`[Visual Search] Found ${visualResults.length} initial visual matches`);

  // Get full details for visual matches
  const visualIds = visualResults.slice(0, 10).map(r => r.productId);
  const visualDetails = await getProductDetails(visualIds);
  
  // Build source context
  sourceContext.referenceTitles = visualDetails.map(p => p.title);
  sourceContext.referenceCategories = [...new Set(visualDetails.map(p => p.categoryId).filter(Boolean))];
  sourceContext.avgPrice = visualDetails.reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0) / visualDetails.length || 1;

  // Add visual results to pool
  for (const product of visualDetails) {
    if (!seenIds.has(product.productId)) {
      seenIds.add(product.productId);
      allProducts.push({
        ...product,
        source: 'visual',
        visualMatchScore: 100 // Perfect match from visual search
      });
    }
  }

  // Stage 2: Expand with keyword search
  if (expandWithKeywords && sourceContext.referenceTitles.length > 0) {
    console.log('[Visual Search] Stage 2: Expanding with keyword search...');
    
    // Extract key terms from product titles
    const keywords = extractKeywords(sourceContext.referenceTitles);
    console.log(`[Visual Search] Extracted keywords: ${keywords.join(', ')}`);

    // Search by keywords
    for (const keyword of keywords.slice(0, 3)) {
      try {
        const keywordResults = await searchByKeywords(keyword, 50);
        for (const product of keywordResults) {
          if (!seenIds.has(product.productId)) {
            seenIds.add(product.productId);
            
            // Calculate similarity to source
            const similarity = calculateSimilarity(product, sourceContext);
            
            if (similarity >= 60) { // Only add if similar enough
              allProducts.push({
                ...product,
                source: 'keyword',
                visualMatchScore: similarity,
                matchedKeyword: keyword
              });
            }
          }
        }
      } catch (e) {
        console.log(`[Visual Search] Keyword "${keyword}" search failed:`, e.message);
      }
    }
  }

  // Stage 3: Add hot products from relevant categories
  if (includeHotProducts && sourceContext.referenceCategories.length > 0) {
    console.log('[Visual Search] Stage 3: Adding hot products...');
    
    for (const categoryId of sourceContext.referenceCategories.slice(0, 2)) {
      try {
        const hotProducts = await getHotProducts({
          categoryId,
          pageSize: 50
        });
        
        for (const product of hotProducts) {
          if (!seenIds.has(product.productId)) {
            seenIds.add(product.productId);
            
            const similarity = calculateSimilarity(product, sourceContext);
            
            if (similarity >= 50) {
              allProducts.push({
                ...product,
                source: 'hot',
                visualMatchScore: similarity,
                isHotProduct: true
              });
            }
          }
        }
      } catch (e) {
        console.log(`[Visual Search] Hot products for category ${categoryId} failed:`, e.message);
      }
    }
  }

  // Stage 4: Add promo products
  if (includePromoProducts) {
    console.log('[Visual Search] Stage 4: Adding promo products...');
    
    try {
      const promoProducts = await getFeaturedPromoProducts({ pageSize: 100 });
      
      // Filter promo products that match our keywords
      for (const product of promoProducts) {
        if (!seenIds.has(product.productId)) {
          const matchesKeywords = sourceContext.referenceTitles.some(ref => 
            titleSimilarity(product.title, ref) > 0.5
          );
          
          if (matchesKeywords) {
            seenIds.add(product.productId);
            allProducts.push({
              ...product,
              source: 'promo',
              visualMatchScore: 60,
              isPromoProduct: true
            });
          }
        }
      }
    } catch (e) {
      console.log('[Visual Search] Promo products failed:', e.message);
    }
  }

  console.log(`[Visual Search] Total products before clustering: ${allProducts.length}`);

  // Stage 5: Cluster similar products
  console.log('[Visual Search] Stage 5: Clustering similar products...');
  const clusters = clusterSimilarProducts(allProducts, similarityThreshold);
  console.log(`[Visual Search] Created ${clusters.length} clusters`);

  // Stage 6: Select best products from each cluster
  const selectedProducts = [];
  for (const cluster of clusters) {
    // Sort by value (visual match + price + rating)
    cluster.products.sort((a, b) => calculateValueScore(b) - calculateValueScore(a));
    
    // Take best from each cluster
    const best = cluster.products[0];
    selectedProducts.push({
      ...best,
      clusterId: cluster.id,
      clusterSize: cluster.products.length,
      priceRange: cluster.priceRange,
      similarProductsCount: cluster.products.length - 1
    });
    
    // Add more from large clusters if we need more results
    if (cluster.products.length > 3 && selectedProducts.length < targetResults) {
      selectedProducts.push({
        ...cluster.products[1],
        clusterId: cluster.id,
        clusterSize: cluster.products.length,
        priceRange: cluster.priceRange,
        similarProductsCount: cluster.products.length - 1,
        isAlternative: true
      });
    }
  }

  // Sort final results by value score
  selectedProducts.sort((a, b) => calculateValueScore(b) - calculateValueScore(a));

  console.log(`[Visual Search] Final: ${selectedProducts.length} products from ${clusters.length} clusters\n`);

  return {
    products: selectedProducts.slice(0, targetResults),
    clusters: clusters.map(c => ({
      id: c.id,
      size: c.products.length,
      priceRange: c.priceRange,
      representativeTitle: c.representative.title.substring(0, 50)
    })),
    stats: {
      totalScanned: allProducts.length,
      clustersFound: clusters.length,
      sources: {
        visual: allProducts.filter(p => p.source === 'visual').length,
        keyword: allProducts.filter(p => p.source === 'keyword').length,
        hot: allProducts.filter(p => p.source === 'hot').length,
        promo: allProducts.filter(p => p.source === 'promo').length
      }
    },
    sourceContext
  };
}

/**
 * Get visual matches from AliExpress (current scraping method)
 * @param {string} imageUrl - Image URL to search
 * @param {string} locale - User locale (e.g., 'en', 'es', 'fr')
 */
async function getVisualMatchesFromAliExpress(imageUrl, locale = 'en') {
  const { getIdsByImage } = require('./aliexpress.js');
  const result = await getIdsByImage(imageUrl, { locale });
  return result.productIds.map(id => ({ productId: id }));
}

/**
 * Extract keywords from product titles
 */
function extractKeywords(titles) {
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
  
  const wordFreq = {};
  
  for (const title of titles) {
    const words = title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));
    
    for (const word of words) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  }
  
  // Return most frequent words
  return Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

/**
 * Calculate similarity between product and source context
 */
function calculateSimilarity(product, sourceContext) {
  let score = 0;
  
  // Title similarity (40%)
  const titleSim = Math.max(...sourceContext.referenceTitles.map(ref => 
    titleSimilarity(product.title, ref)
  ));
  score += titleSim * 40;
  
  // Category match (20%)
  if (sourceContext.referenceCategories.includes(product.categoryId)) {
    score += 20;
  }
  
  // Price similarity (20%)
  const productPrice = parseFloat(product.price) || 0;
  if (sourceContext.avgPrice > 0) {
    const priceRatio = productPrice / sourceContext.avgPrice;
    if (priceRatio >= 0.5 && priceRatio <= 2) {
      score += 20;
    }
  }
  
  // Choice/Top brand bonus (10%)
  if (product.isChoiceItem) score += 5;
  if (product.isTopBrand) score += 5;
  
  // Rating bonus (10%)
  const rating = parseFloat(product.rating) || 0;
  score += (rating / 5) * 10;
  
  return Math.min(100, Math.round(score));
}

/**
 * Calculate title similarity using Jaccard index
 */
function titleSimilarity(title1, title2) {
  const words1 = new Set(title1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(title2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Cluster similar products
 */
function clusterSimilarProducts(products, threshold = 0.85) {
  const clusters = [];
  let clusterId = 0;
  
  for (const product of products) {
    let added = false;
    
    // Try to add to existing cluster
    for (const cluster of clusters) {
      if (isVisuallySimilar(product, cluster.representative, threshold)) {
        cluster.products.push(product);
        added = true;
        break;
      }
    }
    
    // Create new cluster
    if (!added) {
      clusterId++;
      const prices = [parseFloat(product.price) || 0];
      clusters.push({
        id: `cluster-${clusterId}`,
        representative: product,
        products: [product],
        prices: prices,
        get priceRange() {
          const validPrices = this.prices.filter(p => p > 0);
          return {
            min: Math.min(...validPrices),
            max: Math.max(...validPrices),
            avg: validPrices.reduce((a, b) => a + b, 0) / validPrices.length
          };
        }
      });
    }
  }
  
  return clusters;
}

/**
 * Check if two products are visually similar
 */
function isVisuallySimilar(product1, product2, threshold) {
  const checks = [
    // Title similarity (>70%)
    titleSimilarity(product1.title, product2.title) > 0.7,
    
    // Category match
    product1.categoryId && product2.categoryId && product1.categoryId === product2.categoryId,
    
    // Price similarity (within 40%)
    (() => {
      const p1 = parseFloat(product1.price) || 0;
      const p2 = parseFloat(product2.price) || 0;
      if (p1 === 0 || p2 === 0) return false;
      const ratio = Math.max(p1, p2) / Math.min(p1, p2);
      return ratio <= 1.4; // Within 40%
    })()
  ];
  
  // Must pass at least 2 out of 3 checks
  const passCount = checks.filter(Boolean).length;
  return passCount >= 2;
}

/**
 * Calculate value score for ranking
 */
function calculateValueScore(product) {
  const visualMatch = product.visualMatchScore || 50;
  const rating = (parseFloat(product.rating) || 0) * 10;
  const sales = Math.min(Math.log10(parseInt(product.sales) || 1) * 5, 20);
  const discount = parseFloat(product.discount) || 0;
  const choiceBonus = product.isChoiceItem ? 10 : 0;
  const hotBonus = product.isHotProduct ? 5 : 0;
  const promoBonus = product.isPromoProduct ? 3 : 0;
  
  // Price competitiveness (lower is better, but normalized)
  const priceScore = product.clusterSize > 1 ? 15 : 5;
  
  return visualMatch + rating + sales + discount + choiceBonus + hotBonus + promoBonus + priceScore;
}

module.exports = {
  visualSearchEnhanced,
  getVisualMatchesFromAliExpress,
  extractKeywords,
  calculateSimilarity,
  clusterSimilarProducts,
  calculateValueScore
};
