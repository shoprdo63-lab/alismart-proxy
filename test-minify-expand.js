// Test minification and expansion
const { minifyResponse } = require('./services/json-minify.js');

// Create a sample minimal mode product
const sampleProduct = {
  title: 'Test Headphones',
  price: '$49.99',
  imgUrl: 'https://example.com/image.jpg',
  affiliateLink: 'https://affiliate.link',
  discountPct: 20,
  shippingCost: 5.99,
  isChoiceItem: false,
  itemUrl: 'https://item.url',
  priorityScore: 85.5,
  relevanceScore: 80
};

// Create a full API response
const response = {
  success: true,
  count: 1,
  products: [sampleProduct],
  data: [sampleProduct],
  executionTimeMs: 100
};

console.log('Original response product fields:', Object.keys(sampleProduct));
console.log('Has relevanceScore?', 'relevanceScore' in sampleProduct);
console.log('relevanceScore value:', sampleProduct.relevanceScore);

console.log('\n=== Testing minification ===');
const minified = minifyResponse(response, true); // true = minimal mode
console.log('Minified keys:', Object.keys(minified));
const minifiedProduct = minified.data ? minified.data[0] : minified.products ? minified.products[0] : null;
console.log('Minified product keys:', minifiedProduct ? Object.keys(minifiedProduct) : 'no product');
console.log('Minified product:', JSON.stringify(minifiedProduct, null, 2));

// Now test the expansion from test-api.js
const REVERSE_MAP = {
  't': 'title', 'p': 'price', 'i': 'imgUrl', 'a': 'affiliateLink',
  'id': 'productId', 'op': 'originalPrice', 'pn': 'priceNumeric',
  'c': 'currency', 'd': 'discountPct', 'u': 'productUrl',
  'r': 'rating', 's': 'totalSales', 'ts': 'trustScore',
  'st': 'storeUrl', 'cr': 'commissionRate', 'cat': 'category',
  'sh': 'shippingSpeed', 'rs': 'relevanceScore', 'mp': 'marketPosition',
  'sc': 'shippingCost', 'ic': 'isChoiceItem', 'w': 'packageWeight',
  'cid': 'categoryId', 'bid': 'bundleId', 'bc': 'bundleCount',
  'pbs': 'productsByStore', 'oid': 'originalId', 'aid': 'alternativeId'
};

function expandProduct(product) {
  if (!product || typeof product !== 'object') return product;
  
  // Check if this appears to be minified (has common minified keys)
  const isMinified = ('t' in product && !('title' in product)) || 
                    ('p' in product && !('price' in product));
  
  if (!isMinified) return product;
  
  const expanded = {};
  for (const [key, value] of Object.entries(product)) {
    const expandedKey = REVERSE_MAP[key] || key;
    expanded[expandedKey] = value;
  }
  return expanded;
}

console.log('\n=== Testing expansion ===');
const expanded = expandProduct(minifiedProduct);
console.log('Expanded keys:', Object.keys(expanded));
console.log('Has relevanceScore?', 'relevanceScore' in expanded);
console.log('relevanceScore value:', expanded.relevanceScore);

// Also test what happens if rs is 0
console.log('\n=== Testing with rs = 0 ===');
const productWithZero = {
  t: 'Test',
  p: '$10',
  i: 'img.jpg',
  a: 'link',
  rs: 0
};
const expandedZero = expandProduct(productWithZero);
console.log('Expanded product with rs=0:', expandedZero);
console.log('Has relevanceScore?', 'relevanceScore' in expandedZero);
console.log('relevanceScore value:', expandedZero.relevanceScore);