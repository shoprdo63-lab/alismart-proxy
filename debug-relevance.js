const { analyzeNiche, filterByRelevance, calcRelevanceScore } = require('./services/analytics.js');

// Create mock products similar to what the API might return
const mockProducts = Array.from({length: 10}, (_, i) => ({
  productId: `prod_${i + 1}`,
  title: i < 5 
    ? `Wireless Bluetooth Headphones Noise Cancelling Premium Model ${i + 1}`
    : `Unrelated Product ${i + 1} - Kitchen Item`,
  price: `$${50 + i * 10}.00`,
  originalPrice: `$${100 + i * 20}.00`,
  rating: 4.0 + Math.random() * 1.0,
  totalSales: 100 + i * 50,
  storeUrl: `https://store-${i % 3}.com`,
  commissionRate: '5%'
}));

const query = 'wireless bluetooth headphones noise cancelling';

console.log('=== Testing filterByRelevance ===');
console.log('Query:', query);
const filterResult = filterByRelevance(mockProducts, query, 10);
console.log('Total products:', mockProducts.length);
console.log('Relevant after filter:', filterResult.relevant.length);
console.log('Dropped:', filterResult.droppedCount);

// Check relevance scores on filtered products
console.log('\nRelevance scores on filtered products:');
filterResult.relevant.forEach((p, i) => {
  console.log(`  ${i}: "${p.title.substring(0, 40)}..." - score: ${p.relevanceScore}`);
});

console.log('\n=== Testing analyzeNiche ===');
const nicheResult = analyzeNiche(filterResult.relevant, query);
console.log('Enriched products count:', nicheResult.enrichedProducts.length);
console.log('First product relevanceScore:', nicheResult.enrichedProducts[0]?.relevanceScore);
console.log('Last product relevanceScore:', nicheResult.enrichedProducts[nicheResult.enrichedProducts.length - 1]?.relevanceScore);

// Check all scores
console.log('\nAll relevance scores from analyzeNiche:');
nicheResult.enrichedProducts.forEach((p, i) => {
  console.log(`  ${i}: score: ${p.relevanceScore}`);
});

// Test calcRelevanceScore directly
console.log('\n=== Direct calcRelevanceScore tests ===');
const testPairs = [
  ['wireless bluetooth headphones', 'Wireless Bluetooth Headphones Premium'],
  ['noise cancelling', 'Noise Cancelling Headphones'],
  ['unrelated query', 'Kitchen Item Blender'],
];

for (const [q, title] of testPairs) {
  const score = calcRelevanceScore(q, title);
  console.log(`Query: "${q}", Title: "${title}" → Score: ${score}`);
}