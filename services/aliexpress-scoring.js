/**
 * AliExpress Professional Scoring System
 * Calculates comprehensive sourcing scores for AliExpress products
 */

/**
 * Extract numeric price from price string
 */
function extractPrice(priceStr) {
  if (!priceStr) return 0;
  const match = String(priceStr).match(/[\d,.]+/);
  if (!match) return 0;
  // Handle both 1,234.56 and 1.234,56 formats
  const cleaned = match[0].replace(/,/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Calculate AliExpress Price Competitiveness Score (0-100)
 * Compares product price to category average
 */
function calculatePriceCompetitiveness(product, categoryStats) {
  const price = extractPrice(product.price);
  if (!price || !categoryStats || !categoryStats.avgPrice) {
    return 50; // Neutral score if no data
  }

  const avgPrice = categoryStats.avgPrice;
  const ratio = price / avgPrice;

  // Score calculation:
  // ratio = 0.7 (30% cheaper) → score = 100
  // ratio = 1.0 (same price) → score = 75
  // ratio = 1.3 (30% more expensive) → score = 50
  // ratio = 2.0 (double price) → score = 25
  
  let score = 75 - (ratio - 1) * 50;
  
  // Penalize extremely cheap (likely scam) and extremely expensive
  if (ratio < 0.3) score -= 20; // Too cheap to be true
  if (ratio > 3.0) score -= 20; // Way too expensive
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate AliExpress Quality Score (0-100)
 * Based on rating and order count
 */
function calculateQualityScore(product) {
  const rating = product.rating || 0;
  const orders = product.totalSales || 0;

  // Rating component: 0-75 points (5 stars = 75 points)
  const ratingScore = Math.min(rating * 15, 75);

  // Orders component: logarithmic scale
  // 50 orders = 10 points
  // 100 orders = 16 points
  // 500 orders = 23 points
  // 1000 orders = 27 points
  // 5000 orders = 35 points
  // 10000+ orders = 40 points (max)
  const ordersScore = orders > 0 
    ? Math.min(Math.log10(orders) * 10, 40)
    : 0;

  // Choice item bonus
  const choiceBonus = product.isChoiceItem ? 10 : 0;

  const totalScore = ratingScore + ordersScore + choiceBonus;
  return Math.min(100, totalScore);
}

/**
 * Calculate Sales Velocity Score (0-100)
 * Based on recent sales trend
 */
function calculateSalesVelocity(product) {
  const orders = product.totalSales || 0;
  
  // If we had 30-day sales data, we'd use that
  // For now, use total orders as proxy
  
  // Score based on order velocity potential
  // 0-100 orders = 0-20 points
  // 100-1000 orders = 20-50 points
  // 1000-10000 orders = 50-80 points
  // 10000+ orders = 80-100 points
  
  if (orders < 50) return Math.max(0, orders / 2.5);
  if (orders < 500) return 20 + ((orders - 50) / 450) * 30;
  if (orders < 5000) return 50 + ((orders - 500) / 4500) * 30;
  
  return Math.min(100, 80 + ((orders - 5000) / 50000) * 20);
}

/**
 * Calculate AliExpress Seller Reliability Score (0-100)
 */
function calculateSellerReliability(product) {
  // In production, this would use store-level metrics
  // For now, infer from available data
  
  let score = 50; // Base score

  // Store name presence (basic signal)
  if (product.storeName && product.storeName.length > 0) {
    score += 5;
  }

  // Choice seller indicator (AliExpress curated)
  if (product.isChoiceItem) {
    score += 20;
  }

  // High order count indicates established seller
  if (product.totalSales > 1000) {
    score += 10;
  }
  if (product.totalSales > 10000) {
    score += 10;
  }

  // High rating indicates reliable seller
  if (product.rating >= 4.8) {
    score += 15;
  } else if (product.rating >= 4.5) {
    score += 10;
  } else if (product.rating >= 4.0) {
    score += 5;
  }

  return Math.min(100, score);
}

/**
 * Calculate Shipping Score (0-100)
 */
function calculateShippingScore(product) {
  let score = 30; // Base score

  const shippingCost = extractPrice(product.shippingCost);

  // Free shipping is a big plus
  if (shippingCost === 0 || shippingCost < 0.01) {
    score += 40;
  } else if (shippingCost < 5) {
    score += 20;
  } else if (shippingCost < 10) {
    score += 10;
  }

  // Choice items often have better shipping
  if (product.isChoiceItem) {
    score += 15;
  }

  // Low product price with any shipping cost is penalized
  const productPrice = extractPrice(product.price);
  if (productPrice > 0 && shippingCost / productPrice > 0.3) {
    score -= 15; // Shipping is >30% of product price
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Calculate Discount Value Score (0-100)
 * Evaluates if the discount is real and significant
 */
function calculateDiscountValue(product) {
  const discountPct = product.discountPct || 0;
  const originalPrice = extractPrice(product.originalPrice);
  const salePrice = extractPrice(product.price);

  if (!originalPrice || !salePrice || originalPrice <= salePrice) {
    return 0;
  }

  // Calculate real discount
  const realDiscount = ((originalPrice - salePrice) / originalPrice) * 100;

  // Score based on discount magnitude
  if (realDiscount >= 50) return 100;
  if (realDiscount >= 40) return 90;
  if (realDiscount >= 30) return 80;
  if (realDiscount >= 20) return 65;
  if (realDiscount >= 10) return 50;
  if (realDiscount >= 5) return 30;

  return 10;
}

/**
 * Calculate Complete AliExpress Sourcing Score (0-100)
 * Professional composite score for product ranking
 */
function calculateAliExpressScore(product, categoryStats) {
  const priceScore = calculatePriceCompetitiveness(product, categoryStats);
  const qualityScore = calculateQualityScore(product);
  const velocityScore = calculateSalesVelocity(product);
  const sellerScore = calculateSellerReliability(product);
  const shippingScore = calculateShippingScore(product);

  // Weighted composite score (matches research findings)
  const compositeScore = 
    (priceScore * 0.30) +      // Price competitiveness: 30%
    (qualityScore * 0.25) +      // Quality (rating + orders): 25%
    (velocityScore * 0.20) +     // Sales velocity: 20%
    (sellerScore * 0.15) +       // Seller reliability: 15%
    (shippingScore * 0.10);      // Shipping value: 10%

  return {
    compositeScore: Math.round(compositeScore * 100) / 100,
    priceScore: Math.round(priceScore * 100) / 100,
    qualityScore: Math.round(qualityScore * 100) / 100,
    velocityScore: Math.round(velocityScore * 100) / 100,
    sellerScore: Math.round(sellerScore * 100) / 100,
    shippingScore: Math.round(shippingScore * 100) / 100,
    discountScore: calculateDiscountValue(product)
  };
}

/**
 * Calculate category statistics from product pool
 * Used for price competitiveness benchmarking
 */
function calculateCategoryStats(products) {
  if (!products || products.length === 0) {
    return null;
  }

  const prices = products
    .map(p => extractPrice(p.price))
    .filter(p => p > 0);

  if (prices.length === 0) {
    return null;
  }

  prices.sort((a, b) => a - b);

  const sum = prices.reduce((a, b) => a + b, 0);
  const avg = sum / prices.length;
  const median = prices[Math.floor(prices.length / 2)];
  
  // Remove outliers for more robust stats
  const q1Index = Math.floor(prices.length * 0.25);
  const q3Index = Math.floor(prices.length * 0.75);
  const iqrPrices = prices.slice(q1Index, q3Index + 1);
  const robustAvg = iqrPrices.reduce((a, b) => a + b, 0) / iqrPrices.length;

  return {
    avgPrice: Math.round(avg * 100) / 100,
    medianPrice: Math.round(median * 100) / 100,
    robustAvgPrice: Math.round(robustAvg * 100) / 100,
    minPrice: prices[0],
    maxPrice: prices[prices.length - 1],
    count: prices.length
  };
}

/**
 * Apply AliExpress Quality Gate Filter
 * Removes low-quality products
 */
function applyQualityGate(products) {
  const beforeCount = products.length;
  
  const filtered = products.filter(product => {
    const rating = product.rating || 0;
    const orders = product.totalSales || 0;
    const price = extractPrice(product.price);

    // Must meet minimum thresholds
    if (rating < 3.5) return false;        // Too low rating
    if (orders < 10) return false;          // Not enough sales proof
    if (price <= 0) return false;            // Invalid price
    if (price > 10000) return false;         // Unrealistic price (likely error)

    return true;
  });

  const afterCount = filtered.length;
  const removed = beforeCount - afterCount;
  
  console.log(`[AliExpress Scoring] Quality Gate: ${beforeCount} → ${afterCount} (${removed} removed)`);
  
  return filtered;
}

/**
 * Apply AliExpress Premium Filter
 * For elite tier selection
 */
function applyPremiumFilter(products) {
  return products.filter(product => {
    const rating = product.rating || 0;
    const orders = product.totalSales || 0;

    // Premium criteria
    return rating >= 4.5 && orders >= 100;
  });
}

/**
 * Score entire product pool
 */
function scoreProductPool(products) {
  console.log(`\n[AliExpress Scoring] Starting scoring for ${products.length} products...`);
  
  // Calculate category stats for benchmarking
  const categoryStats = calculateCategoryStats(products);
  console.log(`[AliExpress Scoring] Category stats: avg=$${categoryStats?.avgPrice}, median=$${categoryStats?.medianPrice}`);

  // Apply quality gate
  const qualityProducts = applyQualityGate(products);

  // Score each product
  const scoredProducts = qualityProducts.map(product => {
    const scores = calculateAliExpressScore(product, categoryStats);
    
    return {
      ...product,
      ...scores,
      _categoryStats: categoryStats // Attach for reference
    };
  });

  // Sort by composite score (descending)
  scoredProducts.sort((a, b) => b.compositeScore - a.compositeScore);

  console.log(`[AliExpress Scoring] Top 5 products:`);
  scoredProducts.slice(0, 5).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.title.substring(0, 50)}... Score: ${p.compositeScore} (Price: ${p.priceScore}, Quality: ${p.qualityScore})`);
  });

  return scoredProducts;
}

module.exports = {
  calculateAliExpressScore,
  calculatePriceCompetitiveness,
  calculateQualityScore,
  calculateSalesVelocity,
  calculateSellerReliability,
  calculateShippingScore,
  calculateDiscountValue,
  scoreProductPool,
  applyQualityGate,
  applyPremiumFilter,
  calculateCategoryStats,
  extractPrice
};
