/**
 * Smart Selection System
 * Selects top 1000 products from scored pool using 4-tier strategy
 */

/**
 * Select top 1000 products using AliPrice-inspired tier strategy
 * 
 * Tier 1: Elite (200) - Top composite score, must be premium quality
 * Tier 2: Price Champions (300) - Best price competitiveness
 * Tier 3: Quality Leaders (300) - Highest quality ratings
 * Tier 4: Rising Stars (200) - High potential, diverse selection
 */
function selectTop1000(scoredProducts, targetCount = 1000) {
  console.log(`\n[Smart Selection] Starting selection from ${scoredProducts.length} scored products`);

  if (!scoredProducts || scoredProducts.length === 0) {
    return [];
  }

  const selected = [];
  const selectedIds = new Set();

  // Tier 1: Elite Products (200)
  // Top by composite score, must be premium
  const tier1 = selectTier1Elite(scoredProducts, 200, selectedIds);
  selected.push(...tier1.products);
  tier1.ids.forEach(id => selectedIds.add(id));
  
  console.log(`[Smart Selection] Tier 1 (Elite): ${tier1.products.length} products selected`);

  // Tier 2: Price Champions (300)
  // Best price competitiveness, not already selected
  const remainingForTier2 = scoredProducts.filter(p => !selectedIds.has(p.productId));
  const tier2 = selectTier2PriceChampions(remainingForTier2, 300, selectedIds);
  selected.push(...tier2.products);
  tier2.ids.forEach(id => selectedIds.add(id));
  
  console.log(`[Smart Selection] Tier 2 (Price Champions): ${tier2.products.length} products selected`);

  // Tier 3: Quality Leaders (300)
  // Highest quality score, not already selected
  const remainingForTier3 = scoredProducts.filter(p => !selectedIds.has(p.productId));
  const tier3 = selectTier3QualityLeaders(remainingForTier3, 300, selectedIds);
  selected.push(...tier3.products);
  tier3.ids.forEach(id => selectedIds.add(id));
  
  console.log(`[Smart Selection] Tier 3 (Quality Leaders): ${tier3.products.length} products selected`);

  // Tier 4: Rising Stars (200)
  // Diverse selection with high potential
  const remainingForTier4 = scoredProducts.filter(p => !selectedIds.has(p.productId));
  const tier4 = selectTier4RisingStars(remainingForTier4, 200, selectedIds);
  selected.push(...tier4.products);
  tier4.ids.forEach(id => selectedIds.add(id));
  
  console.log(`[Smart Selection] Tier 4 (Rising Stars): ${tier4.products.length} products selected`);

  // Final sort by composite score for presentation
  selected.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));

  console.log(`\n[Smart Selection] COMPLETE: ${selected.length} products selected`);
  console.log(`[Smart Selection] Breakdown: T1:${tier1.products.length} T2:${tier2.products.length} T3:${tier3.products.length} T4:${tier4.products.length}`);

  return selected.slice(0, targetCount);
}

/**
 * Tier 1: Elite Products
 * Top composite score, premium quality threshold
 */
function selectTier1Elite(products, count, excludeIds) {
  // Filter for premium products only
  const premiumProducts = products.filter(p => {
    // Exclude if already selected
    if (excludeIds.has(p.productId)) return false;
    
    // Must meet premium criteria
    const rating = p.rating || 0;
    const orders = p.totalSales || 0;
    const composite = p.compositeScore || 0;
    
    return rating >= 4.5 && orders >= 100 && composite >= 60;
  });

  // Sort by composite score
  premiumProducts.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));

  const selected = premiumProducts.slice(0, count);
  const ids = new Set(selected.map(p => p.productId));

  return { products: selected, ids };
}

/**
 * Tier 2: Price Champions
 * Best price competitiveness, ensure category diversity
 */
function selectTier2PriceChampions(products, count, excludeIds) {
  // Sort by price score
  const sortedByPrice = products
    .filter(p => !excludeIds.has(p.productId))
    .sort((a, b) => (b.priceScore || 0) - (a.priceScore || 0));

  // Select with diversity enforcement
  const selected = [];
  const categoryCounts = new Map();
  const storeCounts = new Map();

  for (const product of sortedByPrice) {
    if (selected.length >= count) break;

    const category = product.categoryId || 'unknown';
    const store = product.storeUrl || product.storeName || 'unknown';

    // Enforce diversity: max 30 per category, max 5 per store
    const catCount = categoryCounts.get(category) || 0;
    const storeCount = storeCounts.get(store) || 0;

    if (catCount < 30 && storeCount < 5) {
      selected.push(product);
      categoryCounts.set(category, catCount + 1);
      storeCounts.set(store, storeCount + 1);
    }
  }

  // Fill remaining slots if diversity limits left gaps
  if (selected.length < count) {
    const selectedIds = new Set(selected.map(p => p.productId));
    const remaining = sortedByPrice.filter(p => !selectedIds.has(p.productId));
    const needed = count - selected.length;
    selected.push(...remaining.slice(0, needed));
  }

  const ids = new Set(selected.map(p => p.productId));
  return { products: selected, ids };
}

/**
 * Tier 3: Quality Leaders
 * Highest quality scores, diverse selection
 */
function selectTier3QualityLeaders(products, count, excludeIds) {
  // Sort by quality score
  const sortedByQuality = products
    .filter(p => !excludeIds.has(p.productId))
    .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));

  // Select with diversity enforcement
  const selected = [];
  const categoryCounts = new Map();
  const storeCounts = new Map();

  for (const product of sortedByQuality) {
    if (selected.length >= count) break;

    const category = product.categoryId || 'unknown';
    const store = product.storeUrl || product.storeName || 'unknown';

    // Enforce diversity: max 30 per category, max 5 per store
    const catCount = categoryCounts.get(category) || 0;
    const storeCount = storeCounts.get(store) || 0;

    if (catCount < 30 && storeCount < 5) {
      selected.push(product);
      categoryCounts.set(category, catCount + 1);
      storeCounts.set(store, storeCount + 1);
    }
  }

  // Fill remaining
  if (selected.length < count) {
    const selectedIds = new Set(selected.map(p => p.productId));
    const remaining = sortedByQuality.filter(p => !selectedIds.has(p.productId));
    const needed = count - selected.length;
    selected.push(...remaining.slice(0, needed));
  }

  const ids = new Set(selected.map(p => p.productId));
  return { products: selected, ids };
}

/**
 * Tier 4: Rising Stars
 * High potential products, diverse, undiscovered gems
 */
function selectTier4RisingStars(products, count, excludeIds) {
  // Calculate "potential score" for each product
  // Products with good metrics but not yet top performers
  const productsWithPotential = products
    .filter(p => !excludeIds.has(p.productId))
    .map(p => {
      const velocity = p.velocityScore || 0;
      const quality = p.qualityScore || 0;
      const orders = p.totalSales || 0;
      
      // Potential = good velocity relative to total orders
      // Newer products with fast sales = high potential
      let potentialScore = velocity;
      
      // Bonus for good rating but not yet massive sales
      if (quality >= 70 && orders < 1000) {
        potentialScore += 15;
      }
      
      // Bonus for Choice items (AliExpress curated)
      if (p.isChoiceItem) {
        potentialScore += 10;
      }
      
      return { ...p, potentialScore };
    })
    .sort((a, b) => b.potentialScore - a.potentialScore);

  // Select with strong diversity enforcement
  const selected = [];
  const categoryCounts = new Map();
  const storeCounts = new Map();

  for (const product of productsWithPotential) {
    if (selected.length >= count) break;

    const category = product.categoryId || 'unknown';
    const store = product.storeUrl || product.storeName || 'unknown';

    // More strict diversity for tier 4: max 15 per category, max 3 per store
    const catCount = categoryCounts.get(category) || 0;
    const storeCount = storeCounts.get(store) || 0;

    if (catCount < 15 && storeCount < 3) {
      selected.push(product);
      categoryCounts.set(category, catCount + 1);
      storeCounts.set(store, storeCount + 1);
    }
  }

  // Fill remaining
  if (selected.length < count) {
    const selectedIds = new Set(selected.map(p => p.productId));
    const remaining = productsWithPotential.filter(p => !selectedIds.has(p.productId));
    const needed = count - selected.length;
    selected.push(...remaining.slice(0, needed));
  }

  const ids = new Set(selected.map(p => p.productId));
  return { products: selected, ids };
}

/**
 * Get diversity statistics for selected products
 */
function getDiversityStats(products) {
  const categoryCounts = new Map();
  const storeCounts = new Map();
  
  for (const product of products) {
    const category = product.categoryId || 'unknown';
    const store = product.storeUrl || product.storeName || 'unknown';
    
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    storeCounts.set(store, (storeCounts.get(store) || 0) + 1);
  }

  return {
    totalProducts: products.length,
    uniqueCategories: categoryCounts.size,
    uniqueStores: storeCounts.size,
    topCategories: [...categoryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
    topStores: [...storeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
    avgProductsPerCategory: products.length / categoryCounts.size,
    avgProductsPerStore: products.length / storeCounts.size
  };
}

/**
 * Get quality statistics for selected products
 */
function getQualityStats(products) {
  if (products.length === 0) return null;

  const compositeScores = products.map(p => p.compositeScore || 0);
  const priceScores = products.map(p => p.priceScore || 0);
  const qualityScores = products.map(p => p.qualityScore || 0);

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    avgCompositeScore: Math.round(avg(compositeScores) * 100) / 100,
    avgPriceScore: Math.round(avg(priceScores) * 100) / 100,
    avgQualityScore: Math.round(avg(qualityScores) * 100) / 100,
    minCompositeScore: Math.min(...compositeScores),
    maxCompositeScore: Math.max(...compositeScores),
    choiceItemsCount: products.filter(p => p.isChoiceItem).length,
    highRatedCount: products.filter(p => (p.rating || 0) >= 4.5).length
  };
}

/**
 * Main selection pipeline
 */
function selectTopProducts(scoredProducts, targetCount = 1000) {
  const selected = selectTop1000(scoredProducts, targetCount);
  
  const diversity = getDiversityStats(selected);
  const quality = getQualityStats(selected);

  return {
    products: selected,
    stats: {
      diversity,
      quality,
      selectionRate: scoredProducts.length > 0 
        ? Math.round((selected.length / scoredProducts.length) * 1000) / 10 
        : 0
    }
  };
}

module.exports = {
  selectTop1000,
  selectTopProducts,
  getDiversityStats,
  getQualityStats,
  selectTier1Elite,
  selectTier2PriceChampions,
  selectTier3QualityLeaders,
  selectTier4RisingStars
};
