// Check what fields are actually in the minified products
const handler = require('./api/search.js');

function mockReqRes(query, mode = 'exact') {
  const req = {
    method: 'GET',
    query: { q: query, searchMode: mode },
    headers: {
      'x-forwarded-for': '127.0.0.1',
      'x-real-ip': '127.0.0.1'
    },
    connection: { remoteAddress: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' }
  };

  let captured = null;
  const res = {
    setHeader: () => {},
    status: () => ({
      json: (data) => { captured = data; }
    })
  };

  return { req, res, getData: () => captured };
}

async function runTest() {
  const { req, res, getData } = mockReqRes('wireless headphones', 'exact');
  
  console.log('Running API test...');
  await handler(req, res);
  
  const data = getData();
  if (!data) {
    console.error('No data returned');
    return;
  }
  
  console.log('\n=== Checking response structure ===');
  console.log('Success:', data.success || data.ok);
  console.log('Count:', data.count || data.n);
  console.log('Mode:', data.mode || data.m);
  
  const products = data.products || data.data || [];
  console.log('Products count:', products.length);
  
  if (products.length > 0) {
    const sample = products[0];
    console.log('\n=== Sample product (raw minified) ===');
    console.log('Keys:', Object.keys(sample));
    console.log('Sample:', JSON.stringify(sample, null, 2));
    
    // Check for specific fields
    console.log('\n=== Checking for specific minified keys ===');
    console.log('Has t (title)?', 't' in sample, 'value:', sample.t?.substring(0, 30) + '...');
    console.log('Has p (price)?', 'p' in sample);
    console.log('Has i (imgUrl)?', 'i' in sample);
    console.log('Has a (affiliateLink)?', 'a' in sample);
    console.log('Has d (discountPct)?', 'd' in sample);
    console.log('Has sc (shippingCost)?', 'sc' in sample);
    console.log('Has ic (isChoiceItem)?', 'ic' in sample);
    console.log('Has u (itemUrl)?', 'u' in sample);
    console.log('Has ps (priorityScore)?', 'ps' in sample);
    console.log('Has rs (relevanceScore)?', 'rs' in sample);
    
    // Try to expand using json-minify's REVERSE_KEY_MAP
    const { REVERSE_KEY_MAP } = require('./services/json-minify.js');
    console.log('\n=== Expanding with json-minify REVERSE_KEY_MAP ===');
    const expanded = {};
    for (const [key, value] of Object.entries(sample)) {
      const expandedKey = REVERSE_KEY_MAP[key] || key;
      expanded[expandedKey] = value;
    }
    console.log('Expanded keys:', Object.keys(expanded));
    console.log('Has priorityScore?', 'priorityScore' in expanded, 'value:', expanded.priorityScore);
    console.log('Has itemUrl?', 'itemUrl' in expanded, 'value:', expanded.itemUrl?.substring(0, 50) + '...');
    console.log('Has relevanceScore?', 'relevanceScore' in expanded, 'value:', expanded.relevanceScore);
  }
}

runTest().catch(console.error);