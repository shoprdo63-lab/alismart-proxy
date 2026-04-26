/**
 * Quick test for the new worldwide search endpoint (ESM)
 *
 * Usage:
 *   node test-search.js
 *
 * Expects the handler at ./api/search.js (ES module)
 */

import handler from './api/search.js';

function mockReqRes(body) {
  const req = {
    method: 'POST',
    headers: { origin: 'chrome-extension://test-id' },
    body
  };

  let statusCode = null;
  let captured = null;
  const headers = {};

  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { captured = data; },
        end: () => {}
      };
    }
  };

  return { req, res, getData: () => captured, getStatus: () => statusCode, getHeaders: () => headers };
}

async function runTest() {
  console.log('='.repeat(60));
  console.log('  Worldwide Search Endpoint — Smoke Test');
  console.log('='.repeat(60));

  // Test 1: Hebrew query with ILS / Israel
  console.log('\n[Test 1] Hebrew keywords → auto-translate to English');
  const t1 = mockReqRes({
    keywords: 'אוזניות בלוטות',
    language: 'he',
    currency: 'ILS',
    shipToCountry: 'IL',
    maxResults: 10
  });

  const start1 = Date.now();
  await handler(t1.req, t1.res);
  const elapsed1 = Date.now() - start1;

  const d1 = t1.getData();
  console.log(`  Status : ${t1.getStatus()}`);
  console.log(`  Time   : ${elapsed1}ms`);
  if (d1) {
    console.log(`  Success: ${d1.success}`);
    console.log(`  Count  : ${d1.count}`);
    console.log(`  Lang   : ${d1.language}`);
    console.log(`  Curr   : ${d1.currency}`);
    console.log(`  RTL    : ${d1.isRTL}`);
    console.log(`  TranslatedKeywords: ${d1.translatedKeywords || '(none)'}`);
    if (d1.products && d1.products.length > 0) {
      const p = d1.products[0];
      console.log(`  First product:`);
      console.log(`    title : ${p.title?.substring(0, 60)}...`);
      console.log(`    price : ${p.price} ${p.currency}`);
      console.log(`    img   : ${p.imgUrl?.substring(0, 60)}...`);
      console.log(`    aff   : ${p.affiliateLink?.substring(0, 60)}...`);
    }
  } else {
    console.log('  No data returned (possible network/API error)');
  }

  // Test 2: English query (no translation needed)
  console.log('\n[Test 2] English keywords → no translation');
  const t2 = mockReqRes({
    keywords: 'wireless headphones',
    language: 'en',
    currency: 'USD',
    shipToCountry: 'US',
    maxResults: 5
  });

  const start2 = Date.now();
  await handler(t2.req, t2.res);
  const elapsed2 = Date.now() - start2;

  const d2 = t2.getData();
  console.log(`  Status : ${t2.getStatus()}`);
  console.log(`  Time   : ${elapsed2}ms`);
  if (d2) {
    console.log(`  Success: ${d2.success}`);
    console.log(`  Count  : ${d2.count}`);
    console.log(`  TranslatedKeywords: ${d2.translatedKeywords || '(none, as expected)'}`);
  }

  // Test 3: Missing keywords (validation)
  console.log('\n[Test 3] Missing keywords → expect 400');
  const t3 = mockReqRes({ language: 'en' });
  await handler(t3.req, t3.res);
  console.log(`  Status : ${t3.getStatus()}`);
  console.log(`  Error  : ${t3.getData()?.error}`);

  // Test 4: GET request (method not allowed)
  console.log('\n[Test 4] GET request → expect 405');
  const t4 = mockReqRes({});
  t4.req.method = 'GET';
  await handler(t4.req, t4.res);
  console.log(`  Status : ${t4.getStatus()}`);

  console.log('\n' + '='.repeat(60));
  console.log('  Smoke test complete');
  console.log('='.repeat(60));
}

runTest().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
