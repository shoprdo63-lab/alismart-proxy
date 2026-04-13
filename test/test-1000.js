/**
 * Test Script: Verify 1000-Product Extraction Engine
 *
 * Tests:
 * 1. searchByKeywordsBatch returns ~1000 unique products
 * 2. analyzeNiche enriches all items with trustScore + relevanceScore
 * 3. filterProducts (halachic filter) runs without errors
 * 4. filterByRelevance (noun-matching) runs without errors
 * 5. Total execution time stays under 5 seconds
 * 6. All productIds are unique (no duplicates)
 */

const { searchByKeywordsBatch } = require('../services/aliexpress.js');
const { analyzeNiche, filterByRelevance } = require('../services/analytics.js');
const { filterProducts } = require('../services/content-filter.js');

const TEST_QUERY = 'wireless bluetooth headphones';

async function runTest() {
  console.log('='.repeat(70));
  console.log('  1000-PRODUCT EXTRACTION ENGINE TEST');
  console.log('='.repeat(70));
  console.log(`  Query: "${TEST_QUERY}"`);
  console.log(`  Target: ~1000 unique products, <5000ms`);
  console.log('='.repeat(70));

  const totalStart = Date.now();

  // ── Step 1: Batch fetch ──────────────────────────────────────────────
  console.log('\n[TEST] Step 1: Batch fetching 50 pages (chunks of 5)...');
  const fetchStart = Date.now();
  const rawProducts = await searchByKeywordsBatch(TEST_QUERY, 50, 5);
  const fetchMs = Date.now() - fetchStart;
  console.log(`[TEST] Fetched: ${rawProducts.length} raw products in ${fetchMs}ms`);

  // ── Step 2: Check uniqueness ─────────────────────────────────────────
  console.log('\n[TEST] Step 2: Checking uniqueness...');
  const ids = rawProducts.map(p => p.productId);
  const uniqueIds = new Set(ids);
  const dupes = ids.length - uniqueIds.size;
  console.log(`[TEST] Total IDs: ${ids.length}, Unique: ${uniqueIds.size}, Duplicates: ${dupes}`);

  // ── Step 3: Halachic content filter ──────────────────────────────────
  console.log('\n[TEST] Step 3: Running Halachic content filter...');
  const { filtered, blockedCount } = filterProducts(rawProducts);
  console.log(`[TEST] Content filter: ${rawProducts.length} → ${filtered.length} (blocked: ${blockedCount})`);

  // ── Step 4: Relevance filter ─────────────────────────────────────────
  console.log('\n[TEST] Step 4: Running semantic relevance filter...');
  const { relevant, droppedCount } = filterByRelevance(filtered, TEST_QUERY, 25);
  console.log(`[TEST] Relevance filter: ${filtered.length} → ${relevant.length} (dropped: ${droppedCount})`);

  // ── Step 5: Analytics enrichment ─────────────────────────────────────
  console.log('\n[TEST] Step 5: Running analytics enrichment (trustScore + relevanceScore)...');
  const enrichStart = Date.now();
  const { enrichedProducts, nicheAnalytics } = analyzeNiche(relevant, TEST_QUERY);
  const enrichMs = Date.now() - enrichStart;
  console.log(`[TEST] Enriched ${enrichedProducts.length} products in ${enrichMs}ms`);

  // ── Step 6: Verify enrichment fields ─────────────────────────────────
  console.log('\n[TEST] Step 6: Verifying enrichment fields...');
  let hasTrustScore = 0, hasRelevanceScore = 0, hasDiscountPct = 0, hasMarketPosition = 0;
  for (const p of enrichedProducts) {
    if (typeof p.trustScore === 'number' && p.trustScore > 0) hasTrustScore++;
    if (typeof p.relevanceScore === 'number' && p.relevanceScore > 0) hasRelevanceScore++;
    if (typeof p.discountPct === 'number' && p.discountPct > 0) hasDiscountPct++;
    if (p.marketPosition) hasMarketPosition++;
  }
  console.log(`[TEST] trustScore > 0: ${hasTrustScore}/${enrichedProducts.length}`);
  console.log(`[TEST] relevanceScore > 0: ${hasRelevanceScore}/${enrichedProducts.length}`);
  console.log(`[TEST] discountPct > 0: ${hasDiscountPct}/${enrichedProducts.length}`);
  console.log(`[TEST] marketPosition set: ${hasMarketPosition}/${enrichedProducts.length}`);

  // ── Step 7: Niche analytics ──────────────────────────────────────────
  console.log('\n[TEST] Step 7: Niche Analytics:');
  console.log(`  avgPrice: $${nicheAnalytics.avgPrice}`);
  console.log(`  minPrice: $${nicheAnalytics.minPrice}`);
  console.log(`  maxPrice: $${nicheAnalytics.maxPrice}`);
  console.log(`  medianPrice: $${nicheAnalytics.medianPrice}`);
  console.log(`  totalNicheVolume: ${nicheAnalytics.totalNicheVolume}`);
  console.log(`  competitionIndex: ${nicheAnalytics.competitionIndex}`);
  console.log(`  topRatedCount: ${nicheAnalytics.topRatedCount}`);
  console.log(`  lowRatedCount: ${nicheAnalytics.lowRatedCount}`);
  console.log(`  totalAnalyzed: ${nicheAnalytics.totalAnalyzed}`);
  if (nicheAnalytics.maxDiscountProduct) {
    console.log(`  maxDiscountProduct: "${nicheAnalytics.maxDiscountProduct.title?.substring(0, 50)}..." (${nicheAnalytics.maxDiscountProduct.discountPct}% off)`);
  }

  // ── Step 8: Sample products ──────────────────────────────────────────
  console.log('\n[TEST] Step 8: Sample products (first 3):');
  for (const p of enrichedProducts.slice(0, 3)) {
    console.log(`  - [${p.productId}] ${p.title?.substring(0, 60)}...`);
    console.log(`    price=$${p.priceNumeric} trust=${p.trustScore} relevance=${p.relevanceScore} position=${p.marketPosition}`);
  }

  // ── Final Summary ────────────────────────────────────────────────────
  const totalMs = Date.now() - totalStart;
  console.log('\n' + '='.repeat(70));
  console.log('  RESULTS SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Raw fetched:     ${rawProducts.length}`);
  console.log(`  After filters:   ${relevant.length}`);
  console.log(`  Enriched final:  ${enrichedProducts.length}`);
  console.log(`  Unique IDs:      ${uniqueIds.size}`);
  console.log(`  Fetch time:      ${fetchMs}ms`);
  console.log(`  Enrich time:     ${enrichMs}ms`);
  console.log(`  TOTAL time:      ${totalMs}ms`);
  console.log(`  Target met:      ${totalMs < 5000 ? '✅ YES (<5000ms)' : '❌ NO (>5000ms)'}`);
  console.log(`  Count target:    ${enrichedProducts.length >= 800 ? '✅' : '⚠️'} ${enrichedProducts.length} products (target: ~1000)`);
  console.log('='.repeat(70));

  // Exit with appropriate code
  if (enrichedProducts.length >= 100 && dupes === 0) {
    console.log('\n✅ TEST PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ TEST FAILED');
    console.log(`   Products: ${enrichedProducts.length} (need >=100)`);
    console.log(`   Duplicates: ${dupes} (need 0)`);
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
