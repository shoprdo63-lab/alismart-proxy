const { analyzeNiche, filterByRelevance } = require('./services/analytics.js');

// Simulate the exact flow from search.js
// 1. Start with raw products (from AliExpress API)
// 2. Apply filterByRelevance with threshold=10
// 3. Then analyzeNiche
// 4. Check what happens

console.log('=== Simulating search.js relevance flow ===\n');

// Create raw products similar to what AliExpress API returns
const rawProducts = [
  {
    title: 'Wireless Bluetooth Headphones Noise Cancelling Over Ear',
    price: '$49.99',
    productId: '100001',
    rating: 4.5,
    totalSales: 1500,
    storeUrl: 'store1',
    commissionRate: '5%'
  },
  {
    title: 'Bluetooth Headphone Wireless Sport Earphone',
    price: '$29.99',
    productId: '100002',
    rating: 4.2,
    totalSales: 800,
    storeUrl: 'store2',
    commissionRate: '4%'
  },
  {
    title: 'Kitchen Blender Food Processor Mixer',
    price: '$39.99',
    productId: '100003',
    rating: 4.0,
    totalSales: 300,
    storeUrl: 'store3',
    commissionRate: '6%'
  },
  {
    title: 'Noise Cancelling Wireless Headphones Bluetooth 5.0',
    price: '$89.99',
    productId: '100004',
    rating: 4.7,
    totalSales: 2500,
    storeUrl: 'store4',
    commissionRate: '7%'
  }
];

const query = 'wireless bluetooth headphones noise cancelling';

console.log('Step 1: Starting with', rawProducts.length, 'raw products');
console.log('Query:', query);

console.log('\nStep 2: Applying filterByRelevance with threshold=10');
const filterResult = filterByRelevance(rawProducts, query, 10);
console.log('After filter:', filterResult.relevant.length, 'products remain');
console.log('Dropped:', filterResult.droppedCount, 'products');

console.log('\nChecking relevance scores after filter:');
filterResult.relevant.forEach((p, i) => {
  console.log(`  ${i}: "${p.title.substring(0, 50)}..." - score: ${p.relevanceScore}`);
});

console.log('\nStep 3: Applying analyzeNiche to filtered products');
const nicheResult = analyzeNiche(filterResult.relevant, query);
console.log('Enriched products:', nicheResult.enrichedProducts.length);

console.log('\nChecking relevance scores after analyzeNiche:');
nicheResult.enrichedProducts.forEach((p, i) => {
  console.log(`  ${i}: score: ${p.relevanceScore}`);
});

// Now let's test what happens if we call analyzeNiche directly on raw products
console.log('\n=== Alternative: analyzeNiche directly on raw products ===');
const directNicheResult = analyzeNiche(rawProducts, query);
console.log('Direct analyzeNiche results:');
directNicheResult.enrichedProducts.forEach((p, i) => {
  console.log(`  ${i}: "${p.title.substring(0, 40)}..." - score: ${p.relevanceScore}`);
});

// Test the threshold logic
console.log('\n=== Testing threshold logic ===');
const lowThresholdResult = filterByRelevance(rawProducts, query, 25);
console.log('With threshold=25:');
console.log('  Relevant:', lowThresholdResult.relevant.length);
console.log('  Dropped:', lowThresholdResult.droppedCount);

// Check what scores products actually get
console.log('\n=== Calculating actual scores ===');
const { calcRelevanceScore } = require('./services/analytics.js');
rawProducts.forEach((p, i) => {
  const score = calcRelevanceScore(query, p.title);
  console.log(`Product ${i}: "${p.title.substring(0, 40)}..."`);
  console.log(`  Score: ${score}`);
  console.log(`  Would pass threshold=10? ${score >= 10}`);
  console.log(`  Would pass threshold=25? ${score >= 25}`);
});