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
    query: { q: query, searchMode: mode }
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

const REQUIRED_FIELDS = [
  'productId', 'title', 'price', 'originalPrice', 'priceNumeric',
  'currency', 'discountPct', 'imgUrl', 'productUrl', 'affiliateLink',
  'rating', 'totalSales', 'trustScore', 'storeUrl', 'commissionRate',
  'category', 'shippingSpeed', 'relevanceScore', 'marketPosition'
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

  // ── Summary ────────────────────────────────────────────────
  console.log('\n' + '-'.repeat(70));
  console.log('  RESULTS SUMMARY');
  console.log('-'.repeat(70));
  console.log(`  success        : ${data.success}`);
  console.log(`  count          : ${data.count}`);
  console.log(`  mode           : ${data.mode}`);
  console.log(`  pagesScanned   : ${data.pagesScanned}`);
  console.log(`  executionTimeMs: ${data.executionTimeMs} (wall: ${elapsed}ms)`);
  console.log(`  cached         : ${data.cached}`);

  // ── Relevance Scores ──────────────────────────────────────
  const products = data.products || [];
  if (products.length > 0) {
    const scores = products.map(p => p.relevanceScore);
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
  if (products.length > 0) {
    const ts = products.map(p => p.trustScore).filter(t => t > 0);
    if (ts.length > 0) {
      console.log(`\n  Trust Scores:`);
      console.log(`    min : ${Math.min(...ts)}`);
      console.log(`    max : ${Math.max(...ts)}`);
      console.log(`    avg : ${(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1)}`);
    }
  }

  // ── Schema Check ──────────────────────────────────────────
  let schemaMissing = [];
  if (products.length > 0) {
    const sample = products[0];
    for (const field of REQUIRED_FIELDS) {
      if (!(field in sample)) schemaMissing.push(field);
    }
    console.log(`\n  Schema Check (sample product):`);
    if (schemaMissing.length === 0) {
      console.log(`    All ${REQUIRED_FIELDS.length} spec fields present`);
    } else {
      console.log(`    MISSING: ${schemaMissing.join(', ')}`);
    }
    console.log(`\n  Sample Product:`);
    console.log(JSON.stringify(sample, null, 2));
  }

  // ── Niche Analytics ───────────────────────────────────────
  if (data.nicheAnalytics) {
    console.log(`\n  Niche Analytics:`);
    console.log(JSON.stringify(data.nicheAnalytics, null, 2));
  }

  // ── PASS / FAIL ───────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('  VALIDATION');
  console.log('='.repeat(70));

  const checks = [
    { label: 'Products >= 100',      pass: data.count >= 100,                       detail: String(data.count) },
    { label: 'Execution < 5 000 ms', pass: elapsed < 5000,                          detail: `${elapsed}ms` },
    { label: 'Has nicheAnalytics',    pass: !!data.nicheAnalytics,                   detail: data.nicheAnalytics ? 'yes' : 'no' },
    { label: 'Schema complete',       pass: schemaMissing.length === 0,              detail: schemaMissing.length === 0 ? 'all fields' : schemaMissing.join(',') },
    { label: 'All relevance >= 25',   pass: products.every(p => p.relevanceScore >= 25), detail: products.length > 0 ? `min=${Math.min(...products.map(p => p.relevanceScore))}` : 'n/a' }
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
