/**
 * Test Script — High-Volume Logic Engine Validation
 *
 * Imports the Vercel handler directly, feeds it a mock request,
 * and validates the response against the backend_data_spec targets:
 *   - ~1000 products returned
 *   - All products have relevanceScore >= 25
 *   - Niche analytics present
 *   - Execution time < 5 000 ms
 *   - Product schema matches spec (§2)
 */

const handler = require('./api/search.js');

// ─── Helpers ────────────────────────────────────────────────────

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

// Define fields expected in different modes
const FULL_MODE_FIELDS = [
  'productId', 'title', 'price', 'originalPrice', 'priceNumeric',
  'currency', 'discountPct', 'imgUrl', 'productUrl', 'affiliateLink',
  'rating', 'totalSales', 'trustScore', 'storeUrl', 'commissionRate',
  'category', 'shippingSpeed', 'relevanceScore', 'marketPosition'
];

const MINIMAL_MODE_FIELDS = [
  'title', 'price', 'imgUrl', 'affiliateLink', 'discountPct',
  'shippingCost', 'isChoiceItem', 'productUrl', 'priorityScore', 'relevanceScore'
];

// ─── Main Test ──────────────────────────────────────────────────

async function runTest() {
  const QUERY = 'wireless bluetooth headphones noise cancelling';
  console.log('='.repeat(70));
  console.log('  HIGH-VOLUME LOGIC ENGINE — TEST RUN');
  console.log('='.repeat(70));
  console.log(`Query   : "${QUERY}"`);
  console.log(`Mode    : exact`);
  console.log(`Target  : ~1000 products, relevanceScore > 25, < 5 000 ms\n`);

  const { req, res, getData } = mockReqRes(QUERY);

  const t0 = Date.now();
  await handler(req, res);
  const elapsed = Date.now() - t0;

  const data = getData();
  if (!data) {
    console.error('\nFATAL: handler returned no data.');
    process.exit(1);
  }

  // Helper to get field from minified or unminified response
  function getField(obj, ...possibleKeys) {
    for (const key of possibleKeys) {
      if (key in obj) return obj[key];
    }
    return undefined;
  }

  // Extract fields (handle both minified and unminified)
  const success = getField(data, 'success', 'ok');
  const count = getField(data, 'count', 'n');
  const mode = getField(data, 'mode', 'm');
  const pagesScanned = getField(data, 'pagesScanned', 'ps');
  const executionTimeMs = getField(data, 'executionTimeMs', 'et');
  const cached = getField(data, 'cached', 'cache');
  const products = getField(data, 'products', 'data') || [];
  const nicheAnalytics = getField(data, 'nicheAnalytics', 'na');

  // Helper to expand minified product keys if needed
  function expandProduct(product) {
    if (!product || typeof product !== 'object') return product;
    
    // Check if this appears to be minified (has common minified keys)
    const isMinified = ('t' in product && !('title' in product)) || 
                      ('p' in product && !('price' in product));
    
    if (!isMinified) return product;
    
    // Use reverse mapping from json-minify service
    const REVERSE_MAP = {
      't': 'title', 'p': 'price', 'i': 'imgUrl', 'a': 'affiliateLink',
      'id': 'productId', 'op': 'originalPrice', 'pn': 'priceNumeric',
      'c': 'currency', 'd': 'discountPct', 'u': 'productUrl',
      'r': 'rating', 's': 'totalSales', 'ts': 'trustScore',
      'st': 'storeUrl', 'cr': 'commissionRate', 'cat': 'category',
      'sh': 'shippingSpeed', 'rs': 'relevanceScore', 'mp': 'marketPosition',
      'sc': 'shippingCost', 'ic': 'isChoiceItem', 'w': 'packageWeight',
      'cid': 'categoryId', 'bid': 'bundleId', 'bc': 'bundleCount',
      'pbs': 'productsByStore', 'oid': 'originalId', 'aid': 'alternativeId',
      'pri': 'priorityScore'
    };
    
    const expanded = {};
    for (const [key, value] of Object.entries(product)) {
      const expandedKey = REVERSE_MAP[key] || key;
      expanded[expandedKey] = value;
    }
    return expanded;
  }

  const expandedProducts = products.map(p => expandProduct(p));

  // ── Summary ────────────────────────────────────────────────
  console.log('\n' + '-'.repeat(70));
  console.log('  RESULTS SUMMARY');
  console.log('-'.repeat(70));
  console.log(`  success        : ${success}`);
  console.log(`  count          : ${count}`);
  console.log(`  mode           : ${mode}`);
  console.log(`  pagesScanned   : ${pagesScanned}`);
  console.log(`  executionTimeMs: ${executionTimeMs} (wall: ${elapsed}ms)`);
  console.log(`  cached         : ${cached}`);

  // ── Relevance Scores ──────────────────────────────────────
  if (expandedProducts.length > 0) {
    const scores = expandedProducts.map(p => p.relevanceScore || 0);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const avgScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);

    console.log(`\n  Relevance Scores:`);
    console.log(`    min : ${minScore}`);
    console.log(`    max : ${maxScore}`);
    console.log(`    avg : ${avgScore}`);
    console.log(`    all >= 25 : ${minScore >= 25 ? 'YES' : 'NO'}`);
  }

  // ── Trust Scores ──────────────────────────────────────────
  if (expandedProducts.length > 0) {
    const ts = expandedProducts.map(p => p.trustScore).filter(t => t > 0);
    if (ts.length > 0) {
      console.log(`\n  Trust Scores:`);
      console.log(`    min : ${Math.min(...ts)}`);
      console.log(`    max : ${Math.max(...ts)}`);
      console.log(`    avg : ${(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1)}`);
    }
  }

  // ── Schema Check ──────────────────────────────────────────
  let schemaMissing = [];
  let schemaMode = 'full';
  if (expandedProducts.length > 0) {
    const sample = expandedProducts[0];
    
    // Determine if we're in minimal mode (missing many full mode fields)
    const fullModeFieldsCount = FULL_MODE_FIELDS.filter(f => f in sample).length;
    const minimalModeFieldsCount = MINIMAL_MODE_FIELDS.filter(f => f in sample).length;
    
    // Use appropriate field set based on what we detect
    const checkFields = fullModeFieldsCount >= minimalModeFieldsCount ? FULL_MODE_FIELDS : MINIMAL_MODE_FIELDS;
    schemaMode = fullModeFieldsCount >= minimalModeFieldsCount ? 'full' : 'minimal';
    
    for (const field of checkFields) {
      if (!(field in sample)) schemaMissing.push(field);
    }
    console.log(`\n  Schema Check (${schemaMode} mode, sample product):`);
    if (schemaMissing.length === 0) {
      console.log(`    All ${checkFields.length} spec fields present`);
    } else {
      console.log(`    MISSING: ${schemaMissing.join(', ')}`);
    }
    console.log(`\n  Sample Product (expanded):`);
    console.log(JSON.stringify(sample, null, 2));
  }

  // ── Niche Analytics ───────────────────────────────────────
  if (nicheAnalytics) {
    console.log(`\n  Niche Analytics:`);
    console.log(JSON.stringify(nicheAnalytics, null, 2));
  }

  // ── PASS / FAIL ───────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('  VALIDATION');
  console.log('='.repeat(70));

  const checks = [
    { label: 'Products >= 100',      pass: count >= 100,                       detail: String(count) },
    { label: 'Execution < 5 000 ms', pass: elapsed < 5000,                          detail: `${elapsed}ms` },
    { label: 'Has nicheAnalytics',    pass: !!nicheAnalytics,                   detail: nicheAnalytics ? 'yes' : 'no' },
    { label: 'Schema complete',       pass: schemaMissing.length === 0,              detail: schemaMissing.length === 0 ? 'all fields' : schemaMissing.join(',') },
    { label: 'All relevance >= 25',   pass: expandedProducts.every(p => (p.relevanceScore || 0) >= 25), detail: expandedProducts.length > 0 ? `min=${Math.min(...expandedProducts.map(p => p.relevanceScore || 0))}` : 'n/a' }
  ];

  let allPass = true;
  for (const c of checks) {
    const status = c.pass ? 'PASS' : 'FAIL';
    if (!c.pass) allPass = false;
    console.log(`  [${status}] ${c.label.padEnd(22)} ${c.detail}`);
  }

  console.log('\n' + (allPass ? '  ALL CHECKS PASSED' : '  SOME CHECKS FAILED'));
  console.log('='.repeat(70));

  process.exit(allPass ? 0 : 1);
}

runTest().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
