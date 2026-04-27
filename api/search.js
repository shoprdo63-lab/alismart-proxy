// api/search.js
// Worldwide AliExpress product search via Affiliate API
// - Translates query to English (AliExpress index works best in English)
// - Fetches a large candidate pool (up to 10,000 items) using multiple sort
//   strategies in parallel, deduped by productId
// - Scores each candidate by semantic relevance + trust, returns top N (≤1000)
import crypto from 'node:crypto';
import { translate } from '@vitalets/google-translate-api';

// ─── Config ─────────────────────────────────────────────────────
const APP_KEY = process.env.ALI_APP_KEY || '528438';
const APP_SECRET = process.env.ALI_APP_SECRET || 'J9gzPRjwGFIOE7UsdvOASnEnuisllPdX';
const TRACKING_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const API_GATEWAY = 'https://api-sg.aliexpress.com/sync';

const PAGE_SIZE = 50;                  // AliExpress hard cap is 50 / page
const MAX_RESULTS = 1000;              // hard ceiling on returned products
const DEFAULT_RESULTS = 50;            // when caller doesn't specify
const MAX_CANDIDATE_POOL = 10000;      // upper bound of items we ever fetch
const DEFAULT_CANDIDATE_POOL = 5000;   // sane default for relevance ranking
const FETCH_CONCURRENCY = 8;           // parallel API requests per wave
const RELEVANCE_THRESHOLD = 20;        // drop items scoring below this (0–100) - lowered to allow more results

const SEARCH_CACHE_TTL = 1000 * 60 * 10;            // 10 minutes
const TRANSLATION_CACHE_TTL = 1000 * 60 * 60 * 24;  // 24 hours
const MAX_CACHE_ENTRIES = 500;

// Sort strategies fetched in parallel for diverse coverage
const SORT_STRATEGIES = ['LAST_VOLUME_DESC', 'SALE_PRICE_ASC', ''];
//   - LAST_VOLUME_DESC: best-sellers first (high-trust items)
//   - SALE_PRICE_ASC : cheapest first (price-sensitive shoppers)
//   - ''             : default = AliExpress relevance ranking

const RTL_LANGUAGES = new Set(['he', 'ar', 'ur', 'fa', 'yi']);

// Helper: Generate timestamp in China timezone (GMT+8) for AliExpress API
// Format: YYYY-MM-DD HH:mm:ss (China Standard Time)
function getChinaTimestamp() {
  // Get current UTC time and convert to China time (UTC+8)
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const chinaMs = utcMs + (8 * 60 * 60000); // Add 8 hours for China
  const chinaTime = new Date(chinaMs);
  
  const year = chinaTime.getUTCFullYear();
  const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(chinaTime.getUTCDate()).padStart(2, '0');
  const hours = String(chinaTime.getUTCHours()).padStart(2, '0');
  const minutes = String(chinaTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(chinaTime.getUTCSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// AliExpress Affiliate API official target_language values (ISO → API code)
// Source: Official AliExpress Open Platform docs
// Supported: EN, RU, PT, ES, FR, ID, IT, TH, JA, AR, VI, TR, DE, HE, KO, NL, PL, MX, CL, IW, IN
const ALI_LANGUAGES = {
  en: 'EN',
  ru: 'RU', pt: 'PT', es: 'ES', fr: 'FR',
  id: 'ID', it: 'IT', th: 'TH',
  ja: 'JA', ar: 'AR', vi: 'VI',
  tr: 'TR', de: 'DE', he: 'HE', ko: 'KO',
  nl: 'NL', pl: 'PL',
  mx: 'MX', cl: 'CL',
  iw: 'IW', in: 'IN'
};

// Minimal English stopword list — kept short to avoid over-filtering
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'and', 'or',
  'is', 'are', 'be', 'this', 'that', 'it', 'as', 'at', 'by', 'from'
]);

// ─── Caches ─────────────────────────────────────────────────────
const searchCache = new Map();
const translationCache = new Map();

// ─── CORS ───────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean));
const EXTENSION_ID = process.env.EXTENSION_ID || '';

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin) ||
    (EXTENSION_ID && origin === `chrome-extension://${EXTENSION_ID}`) ||
    ALLOWED_ORIGINS.has('*') ||
    origin.startsWith('chrome-extension://');
}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', isAllowedOrigin(origin) ? origin : '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Parse JSON body from POST requests
async function parseBody(req) {
  if (req.method !== 'POST') return {};
  if (req.body && typeof req.body === 'object') return req.body; // Already parsed

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    // Try URL-encoded format
    const params = new URLSearchParams(rawBody);
    const result = {};
    for (const [key, value] of params) {
      result[key] = value;
    }
    return result;
  }
}

// ─── Handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Support both GET (query params) and POST (JSON body)
  let body;
  if (req.method === 'GET') {
    body = req.query || {};
  } else if (req.method === 'POST') {
    body = await parseBody(req);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Debug logging - remove in production
  console.log('[Search] Request:', { method: req.method, url: req.url, headers: req.headers['content-type'], body });

  const t0 = Date.now();
  const {
    keywords,
    q,                    // backward compat alias for keywords
    keyword,              // extension sends 'keyword' (singular)
    productUrl,
    url,                  // backward compat alias
    productId,            // for similar products
    productTitle,         // product title for better similar product search
    title,                // alias for productTitle
    similar,              // flag to fetch similar products
    maxResults = DEFAULT_RESULTS,
    candidatePoolSize = DEFAULT_CANDIDATE_POOL,
    language = 'en',
    locale,               // extension sends 'locale' (e.g., 'en_US')
    currency = 'USD',
    shipToCountry,
    autoTranslate = true,
    minRelevance = RELEVANCE_THRESHOLD
  } = body;

  // Support extension's 'locale' parameter (e.g., 'en_US' -> 'en')
  const effectiveLanguage = locale ? locale.split('_')[0] : language;

  // Check if this is a similar products request
  const isSimilarRequest = similar === 'true' || similar === true || productId;

  const searchKeywords = (keywords || q || keyword || extractTitleFromUrl(productUrl || url) || '').trim();
  if (!searchKeywords && !isSimilarRequest) {
    return res.status(400).json({ error: 'Keywords, productUrl, or productId required' });
  }

  // Normalize input - use effectiveLanguage from locale if provided
  const userLang = effectiveLanguage.toLowerCase().split('-')[0];
  const aliLang = ALI_LANGUAGES[userLang] || 'EN';
  const userCurrency = currency.toUpperCase();
  const isRTL = RTL_LANGUAGES.has(userLang);

  const targetCount = clamp(toInt(maxResults, DEFAULT_RESULTS), 1, MAX_RESULTS);
  
  // Smart candidate pool sizing: when requesting many results, fetch more candidates
  // to ensure we can return highly relevant products after filtering
  const requestedPoolSize = toInt(candidatePoolSize, DEFAULT_CANDIDATE_POOL);
  let autoPoolSize;
  if (targetCount >= 500) {
    autoPoolSize = MAX_CANDIDATE_POOL;
  } else if (targetCount >= 200) {
    autoPoolSize = 8000;
  } else {
    autoPoolSize = requestedPoolSize;
  }
  const poolSize = clamp(autoPoolSize, targetCount, MAX_CANDIDATE_POOL);
  
  // Higher relevance threshold for accuracy, but can be overridden
  const relevanceFloor = clamp(toInt(minRelevance, RELEVANCE_THRESHOLD), 0, 100);

  // Cache lookup
  const cacheKey = `s:${userLang}:${userCurrency}:${shipToCountry || 'GLOBAL'}:${targetCount}:${poolSize}:${relevanceFloor}:${searchKeywords}`;
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < SEARCH_CACHE_TTL)) {
    return res.status(200).json({ ...cached.data, cached: true, executionTimeMs: Date.now() - t0 });
  }

  try {
    // Handle similar products request
    if (isSimilarRequest && productId) {
      const rawCandidates = await fetchSimilarProducts({
        productId,
        productTitle: productTitle || title,  // Pass title for better similar product search
        maxResults: targetCount,
        aliLang,
        currency: userCurrency
      });

      if (rawCandidates.length === 0) {
        console.log('[Similar] No similar products found for', productId);
        return res.status(200).json({
          success: true,
          count: 0,
          products: [],
          language: userLang,
          currency: userCurrency,
          isRTL,
          candidatePoolSize: 0,
          executionTimeMs: Date.now() - t0,
          cached: false,
          similarProducts: true,
          productId
        });
      }

      // Normalize without relevance scoring (already similar)
      const normalized = rawCandidates.map(p => normalizeProduct(p, userCurrency));
      
      // Sort by trust (sales + rating)
      const maxSales = Math.max(...normalized.map(p => p.totalSales), 1);
      for (const n of normalized) {
        n.trustScore = calcTrust(n, maxSales);
      }
      normalized.sort((a, b) => b.trustScore - a.trustScore);

      const products = normalized.slice(0, targetCount);
      
      const responseBody = {
        success: true,
        count: products.length,
        products,
        language: userLang,
        currency: userCurrency,
        isRTL,
        candidatePoolSize: rawCandidates.length,
        executionTimeMs: Date.now() - t0,
        cached: false,
        similarProducts: true,
        productId
      };
      return res.status(200).json(responseBody);
    }

    // 1. Translate to English when needed (AliExpress index works best in English)
    let englishKeywords = searchKeywords;
    if (autoTranslate && userLang !== 'en') {
      englishKeywords = await translateToEnglish(searchKeywords);
    }

    // 2. Build query tokens for relevance scoring (use BOTH original + English)
    const queryTokens = buildQueryTokens(`${searchKeywords} ${englishKeywords}`);

    // 3. Fetch a large candidate pool across multiple sort strategies in parallel
    const fetchStart = Date.now();
    const rawCandidates = await fetchCandidatePool({
      keywords: englishKeywords,
      poolSize,
      aliLang,
      currency: userCurrency,
      shipToCountry
    });
    const fetchMs = Date.now() - fetchStart;

    if (rawCandidates.length === 0) {
      return res.status(200).json({
        success: true, count: 0, products: [], language: userLang,
        currency: userCurrency, isRTL, originalKeywords: searchKeywords,
        translatedKeywords: englishKeywords === searchKeywords ? undefined : englishKeywords,
        candidatePoolSize: 0, executionTimeMs: Date.now() - t0, cached: false
      });
    }

    // 4. Normalize, score relevance + trust
    const normalized = new Array(rawCandidates.length);
    let maxSales = 1;
    for (let i = 0; i < rawCandidates.length; i++) {
      const n = normalizeProduct(rawCandidates[i], userCurrency);
      n.relevanceScore = calcRelevance(queryTokens, n.title);
      if (n.totalSales > maxSales) maxSales = n.totalSales;
      normalized[i] = n;
    }

    // Add trust + composite score (trust depends on max sales of the batch)
    for (let i = 0; i < normalized.length; i++) {
      const n = normalized[i];
      n.trustScore = calcTrust(n, maxSales);
      // composite: relevance dominates (we want similar products, not random hits)
      n.score = n.relevanceScore * 0.7 + n.trustScore * 0.3;
    }

    // 5. Sort by composite score (best first)
    normalized.sort((a, b) => b.score - a.score);

    // 6. Smart filtering: prioritize quality but always return SOMETHING
    // If strict filtering leaves us with nothing or too few, gradually relax
    let filtered = normalized.filter(p => p.relevanceScore >= relevanceFloor);
    
    // STRATEGY: If we filtered out almost everything, use top N by score regardless
    const MIN_PRODUCTS_TO_RETURN = Math.min(30, targetCount, normalized.length);
    
    if (filtered.length < MIN_PRODUCTS_TO_RETURN && normalized.length > 0) {
      // Take top products by composite score, regardless of relevance threshold
      // This ensures we always return the "best available" even if not perfect matches
      console.log(`[Search] Only ${filtered.length} products passed relevance threshold, using top ${MIN_PRODUCTS_TO_RETURN} by score`);
      filtered = normalized.slice(0, MIN_PRODUCTS_TO_RETURN);
    }

    // Take top products up to targetCount
    const products = filtered.slice(0, targetCount);

    const responseBody = {
      success: true,
      count: products.length,
      language: userLang,
      currency: userCurrency,
      isRTL,
      shipToCountry: shipToCountry || null,
      originalKeywords: searchKeywords,
      translatedKeywords: englishKeywords === searchKeywords ? undefined : englishKeywords,
      candidatePoolSize: rawCandidates.length,
      filteredCount: filtered.length,
      droppedByRelevance: normalized.length - filtered.length,
      minRelevanceUsed: relevanceFloor,
      fetchTimeMs: fetchMs,
      executionTimeMs: Date.now() - t0,
      products,
      cached: false
    };

    // Cache (with simple eviction)
    if (searchCache.size >= MAX_CACHE_ENTRIES) searchCache.clear();
    searchCache.set(cacheKey, { data: responseBody, ts: Date.now() });

    return res.status(200).json(responseBody);
  } catch (error) {
    console.error('[Search] Error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch products from AliExpress',
      message: error.message,
      executionTimeMs: Date.now() - t0
    });
  }
}

// ─── Translation ────────────────────────────────────────────────
async function translateToEnglish(text) {
  const cacheKey = `en:${text}`;
  const cached = translationCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < TRANSLATION_CACHE_TTL)) {
    return cached.text;
  }
  try {
    const result = await translate(text, { to: 'en' });
    translationCache.set(cacheKey, { text: result.text, ts: Date.now() });
    return result.text;
  } catch {
    return text; // fail-open: keep original keywords
  }
}

// ─── Candidate Pool Fetching ────────────────────────────────────
/**
 * Fetch up to `poolSize` UNIQUE products by running multiple sort strategies
 * in parallel and deduping by productId. This gives us much broader coverage
 * than a single sort axis would.
 */
async function fetchCandidatePool({ keywords, poolSize, aliLang, currency, shipToCountry }) {
  const seen = new Map(); // productId → raw product
  const pagesPerStrategy = Math.ceil(poolSize / (PAGE_SIZE * SORT_STRATEGIES.length));

  // Build all (strategy, page) tasks up front
  const tasks = [];
  for (const sort of SORT_STRATEGIES) {
    for (let pageNo = 1; pageNo <= pagesPerStrategy; pageNo++) {
      tasks.push({ sort, pageNo });
    }
  }

  // Run tasks in waves of FETCH_CONCURRENCY; stop early if pool is full
  for (let i = 0; i < tasks.length; i += FETCH_CONCURRENCY) {
    if (seen.size >= poolSize) break;

    const wave = tasks.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      wave.map(t => fetchProductPageWithRetry({
        keywords, pageNo: t.pageNo, sort: t.sort,
        aliLang, currency, shipToCountry
      }))
    );

    let waveAddedAny = false;
    let waveErrors = 0;
    for (const r of results) {
      if (r.status === 'rejected') {
        waveErrors++;
        console.error('[Search] Fetch error:', r.reason?.message || r.reason);
        continue;
      }
      if (!r.value) continue;
      for (const p of r.value) {
        if (!p?.product_id) continue;
        if (seen.has(p.product_id)) continue;
        seen.set(p.product_id, p);
        waveAddedAny = true;
        if (seen.size >= poolSize) break;
      }
      if (seen.size >= poolSize) break;
    }

    // If an entire wave produced no new products AND all requests errored,
    // something is wrong with the API — stop early.
    if (!waveAddedAny && waveErrors === results.length) {
      throw new Error(`All API requests failed. Last error: ${results.at(-1)?.reason?.message || 'unknown'}`);
    }
    // NOTE: Removed early stop (!waveAddedAny) to ensure we fetch from all pages
    // AliExpress may return duplicates on some pages but new products on others
  }

  return Array.from(seen.values());
}

async function fetchProductPageWithRetry(args, retries = 1, delayMs = 800) {
  try {
    return await fetchProductPage(args);
  } catch (err) {
    if (retries > 0) {
      console.warn(`[Search] Retry after ${delayMs}ms — ${err.message}`);
      await new Promise(r => setTimeout(r, delayMs));
      return fetchProductPageWithRetry(args, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

async function fetchProductPage({ keywords, pageNo, sort, aliLang, currency, shipToCountry }) {
  const params = {
    app_key: APP_KEY,
    timestamp: getChinaTimestamp(),
    method: 'aliexpress.affiliate.product.query',
    sign_method: 'md5',
    v: '2.0',
    keyWord: keywords,           // AliExpress requires keyWord with capital K
    page_no: String(pageNo),
    page_size: String(PAGE_SIZE),
    target_currency: currency,
    target_language: aliLang,    // e.g., 'EN'
    tracking_id: TRACKING_ID
  };

  if (sort) params.sort = sort;
  if (shipToCountry) params.ship_to_country = shipToCountry.toUpperCase();

  params.sign = generateSignature(params, APP_SECRET);

  const queryString = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const response = await fetch(`${API_GATEWAY}?${queryString}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) throw new Error(`API HTTP ${response.status}`);

  const data = await response.json();
  if (data.error_response) {
    throw new Error(`AliExpress: ${data.error_response.msg || JSON.stringify(data.error_response)}`);
  }

  // AliExpress API response structure varies - try multiple paths
  const result = data.aliexpress_affiliate_product_query_response;
  
  // Debug: log the actual response structure (remove in production)
  if (!result) {
    console.log('[Search] No aliexpress_affiliate_product_query_response in:', Object.keys(data));
  }
  
  // Try multiple possible response paths
  const list = result?.resp_result?.result?.products?.product
            || result?.products?.product
            || result?.resp_result?.result?.product
            || data?.result?.products?.product
            || data?.products?.product;
            
  if (!list) {
    console.log('[Search] No products found in response. Result keys:', result ? Object.keys(result) : 'no result');
    return [];
  }
  
  // Debug: Log first few product titles to verify relevance
  const products = Array.isArray(list) ? list : [list];
  if (products.length > 0) {
    console.log('[Search] AliExpress returned', products.length, 'products. First 3 titles:');
    products.slice(0, 3).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.product_title?.substring(0, 60)}...`);
    });
  }
  
  return products;
}

// ─── Fetch Similar Products ─────────────────────────────────────
// Note: aliexpress.affiliate.product.recommend doesn't work with SYNC endpoint
// So we use: 1) productdetail.get to get product info, 2) search with extracted keywords
async function fetchSimilarProducts({ productId, productTitle, maxResults, aliLang, currency }) {
  // Step 1: Get product details
  console.log('[Similar] Fetching product details for', productId);
  const detailParams = {
    app_key: APP_KEY,
    timestamp: getChinaTimestamp(),
    method: 'aliexpress.affiliate.productdetail.get',
    sign_method: 'md5',
    v: '2.0',
    product_id: String(productId),
    target_currency: currency,
    target_language: aliLang,
    tracking_id: TRACKING_ID
  };

  detailParams.sign = generateSignature(detailParams, APP_SECRET);

  const detailQuery = Object.keys(detailParams)
    .sort((a, b) => a.localeCompare(b))
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(detailParams[k])}`)
    .join('&');

  const detailResponse = await fetch(`${API_GATEWAY}?${detailQuery}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  if (!detailResponse.ok) throw new Error(`API HTTP ${detailResponse.status}`);

  const detailData = await detailResponse.json();
  if (detailData.error_response) {
    throw new Error(`AliExpress: ${detailData.error_response.msg || JSON.stringify(detailData.error_response)}`);
  }

  // Extract product info
  const productResult = detailData.aliexpress_affiliate_productdetail_get_response;
  const product = productResult?.resp_result?.result || productResult?.result;
  
  if (product && product.product_title) {
    // Product found in affiliate API - use its title for search
    const title = product.product_title;
    const keywords = extractSearchKeywords(title); // Extract smart keywords
    console.log('[Similar] Product title from API:', title.substring(0, 80));
    console.log('[Similar] Searching with keywords:', keywords);
    
    // Search using keywords from API product
    return await searchWithKeywords({
      keywords,
      productId,
      maxResults,
      aliLang,
      currency
    });
  } else if (productTitle) {
    // Product NOT in affiliate API, but extension sent title - use it for accurate search
    console.log('[Similar] Product not in API, using title from extension:', productTitle.substring(0, 80));
    
    // Build query tokens from the title for relevance scoring
    const queryTokens = buildQueryTokens(productTitle);
    console.log('[Similar] Query tokens for relevance:', queryTokens);
    
    // Try multiple search strategies from most specific to least specific
    const searchStrategies = buildSearchStrategies(productTitle);
    
    for (const strategy of searchStrategies) {
      console.log('[Similar] Trying search strategy:', strategy.name, '- keywords:', strategy.keywords);
      
      const candidates = await fetchMultiplePages({
        keywords: strategy.keywords,
        maxResults: Math.min(maxResults, 50), // Fetch more to filter
        productId,
        aliLang,
        currency
      });
      
      console.log('[Similar] Strategy', strategy.name, 'returned', candidates.length, 'candidates');
      
      // Filter for truly relevant products
      const relevantProducts = candidates.filter(p => {
        const relevance = calcRelevance(queryTokens, p.product_title || p.title || '');
        return relevance >= 10; // Must have at least 10% relevance
      });
      
      console.log('[Similar] After relevance filter:', relevantProducts.length, 'products');
      
      if (relevantProducts.length >= 5) {
        console.log('[Similar] Strategy', strategy.name, 'found', relevantProducts.length, 'RELEVANT products - using this');
        return relevantProducts.slice(0, maxResults);
      }
      
      // If we got some results but not enough, try to use them
      if (relevantProducts.length > 0 && candidates.length > 0) {
        // Sort by relevance and take top ones
        const scored = candidates.map(p => ({
          product: p,
          relevance: calcRelevance(queryTokens, p.product_title || p.title || '')
        })).sort((a, b) => b.relevance - a.relevance);
        
        const topProducts = scored.slice(0, maxResults).map(s => s.product);
        console.log('[Similar] Using top', topProducts.length, 'products by relevance (scores:', scored.slice(0, 3).map(s => s.relevance).join(','), ')');
        return topProducts;
      }
    }
    
    // If all strategies failed to find relevant products, try synonyms
    console.log('[Similar] All title strategies exhausted, trying synonym searches');
    const synonymSearches = generateSynonymSearches(productTitle);
    
    for (const search of synonymSearches) {
      console.log('[Similar] Trying synonym search:', search.name, '-', search.keywords);
      const candidates = await fetchMultiplePages({
        keywords: search.keywords,
        maxResults: Math.min(maxResults, 50),
        productId,
        aliLang,
        currency
      });
      
      // Score by relevance to original query
      const scored = candidates.map(p => ({
        product: p,
        relevance: calcRelevance(queryTokens, p.product_title || p.title || '')
      })).sort((a, b) => b.relevance - a.relevance);
      
      // Keep only products with at least 10% relevance
      const relevant = scored.filter(s => s.relevance >= 10);
      
      if (relevant.length >= 5) {
        console.log('[Similar] Synonym search', search.name, 'found', relevant.length, 'relevant products');
        return relevant.slice(0, maxResults).map(s => s.product);
      }
      
      // If we got some results but not enough, use best ones
      if (scored.length > 0 && relevant.length === 0) {
        console.log('[Similar] Using top', Math.min(10, scored.length), 'products from', search.name);
        return scored.slice(0, Math.min(maxResults, 10)).map(s => s.product);
      }
    }
    
    // Last resort: category-based search
    console.log('[Similar] All synonym searches exhausted, trying category-based fallback');
    const categoryKeywords = detectProductCategory(productTitle);
    if (categoryKeywords && categoryKeywords !== extractSearchKeywords(productTitle)) {
      console.log('[Similar] Detected category:', categoryKeywords);
      const categoryCandidates = await fetchMultiplePages({
        keywords: categoryKeywords,
        maxResults: Math.min(maxResults, 50),
        productId,
        aliLang,
        currency
      });
      
      // Score by relevance to original query
      const scored = categoryCandidates.map(p => ({
        product: p,
        relevance: calcRelevance(queryTokens, p.product_title || p.title || '')
      })).sort((a, b) => b.relevance - a.relevance);
      
      const topProducts = scored.slice(0, maxResults).map(s => s.product);
      console.log('[Similar] Category search returned', topProducts.length, 'products');
      if (topProducts.length > 0) {
        return topProducts;
      }
    }
  }
  
  // No title from extension and product not in API - this is last resort
  // Try to use productId pattern to guess category, or return empty
  console.log('[Similar] No title from extension, product not in API - limited fallback');
  
  // As absolute last resort, try some popular general categories
  // But limit to a few related ones based on common product patterns
  const limitedFallback = ['popular products', 'best sellers', 'new arrivals'];
  
  console.log('[Similar] Trying limited general search as last resort');
  const results = [];
  for (const keyword of limitedFallback) {
    if (results.length >= maxResults) break;
    try {
      const searchParams = {
        keywords: keyword,
        page_no: 1,
        page_size: Math.min(50, maxResults),
        target_currency: currency,
        target_language: aliLang,
        sort_by: 'hotDegree'
      };
      
      const data = await aliexpressApi('aliexpress.ds.product.search', searchParams);
      if (data?.products?.product) {
        const products = data.products.product;
        for (const p of products) {
          if (results.length >= maxResults) break;
          results.push(p);
        }
      }
    } catch (err) {
      console.log('[Similar] Last resort search failed for:', keyword);
    }
  }
  
  if (results.length > 0) {
    console.log('[Similar] Last resort found', results.length, 'general products');
    return results;
  }
  
  // Truly nothing found - return empty array
  console.log('[Similar] No products found at all');
  return [];
}

// Helper: Search using keywords from product found in API
async function searchWithKeywords({ keywords, productId, maxResults, aliLang, currency }) {
  const searchParams = {
    app_key: APP_KEY,
    timestamp: getChinaTimestamp(),
    method: 'aliexpress.affiliate.product.query',
    sign_method: 'md5',
    v: '2.0',
    keyWord: keywords,
    page_no: '1',
    page_size: String(Math.min(maxResults || 50, 50)),
    target_currency: currency,
    target_language: aliLang,
    tracking_id: TRACKING_ID
  };

  searchParams.sign = generateSignature(searchParams, APP_SECRET);

  const searchQuery = Object.keys(searchParams)
    .sort((a, b) => a.localeCompare(b))
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(searchParams[k])}`)
    .join('&');

  const searchResponse = await fetch(`${API_GATEWAY}?${searchQuery}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  if (!searchResponse.ok) throw new Error(`API HTTP ${searchResponse.status}`);

  const searchData = await searchResponse.json();
  if (searchData.error_response) {
    throw new Error(`AliExpress: ${searchData.error_response.msg || JSON.stringify(searchData.error_response)}`);
  }

  // Parse search results
  const result = searchData.aliexpress_affiliate_product_query_response;
  const list = result?.resp_result?.result?.products?.product
            || result?.products?.product
            || [];

  if (!list || list.length === 0) {
    console.log('[Similar] No similar products found');
    return [];
  }

  const products = Array.isArray(list) ? list : [list];
  // Filter out the original product
  const filtered = products.filter(p => String(p.product_id) !== String(productId));
  console.log('[Similar] Found', filtered.length, 'similar products for', productId);

  return filtered;
}

// ─── Fallback Category Search ───────────────────────────────────
// When a product is not in the affiliate program, search multiple categories
// to find similar products that ARE in the program
async function searchFallbackCategories({ productId, maxResults, aliLang, currency, fallbackKeywords }) {
  console.log('[Similar] Searching fallback categories:', fallbackKeywords.length, 'keywords');
  
  const allProducts = [];
  const seenIds = new Set();
  const productsPerKeyword = Math.ceil((maxResults || 50) / 3); // Split results across keywords
  
  // Try up to 3 keywords to find enough products
  const keywordsToTry = fallbackKeywords.slice(0, 3);
  
  for (const keyword of keywordsToTry) {
    if (allProducts.length >= maxResults) break;
    
    try {
      const searchParams = {
        app_key: APP_KEY,
        timestamp: getChinaTimestamp(),
        method: 'aliexpress.affiliate.product.query',
        sign_method: 'md5',
        v: '2.0',
        keyWord: keyword,
        page_no: '1',
        page_size: String(Math.min(productsPerKeyword + 5, 50)), // Get a few extra for filtering
        target_currency: currency,
        target_language: aliLang,
        tracking_id: TRACKING_ID
      };

      searchParams.sign = generateSignature(searchParams, APP_SECRET);

      const searchQuery = Object.keys(searchParams)
        .sort((a, b) => a.localeCompare(b))
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(searchParams[k])}`)
        .join('&');

      const searchResponse = await fetch(`${API_GATEWAY}?${searchQuery}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });

      if (!searchResponse.ok) continue;

      const searchData = await searchResponse.json();
      if (searchData.error_response) continue;

      const result = searchData.aliexpress_affiliate_product_query_response;
      const list = result?.resp_result?.result?.products?.product
                || result?.products?.product
                || [];

      if (list && list.length > 0) {
        const products = Array.isArray(list) ? list : [list];
        
        // Add unique products (not the original productId)
        for (const p of products) {
          const pid = String(p.product_id);
          if (pid !== String(productId) && !seenIds.has(pid)) {
            seenIds.add(pid);
            allProducts.push(p);
            if (allProducts.length >= maxResults) break;
          }
        }
        
        console.log('[Similar] Keyword', keyword, 'found', products.length, 'products, total unique:', allProducts.length);
      }
    } catch (err) {
      console.log('[Similar] Error searching keyword', keyword, ':', err.message);
    }
  }
  
  console.log('[Similar] Fallback search found total', allProducts.length, 'unique products');
  return allProducts;
}

// ─── Smart Keyword Extraction ─────────────────────────────────────
/**
 * Extract specific search keywords from product title
 * Keeps important words (brand, model, color, type) and removes generic words
 */
function extractSearchKeywords(title) {
  if (!title) return '';
  
  // Words to ignore (too generic)
  const genericWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'with', 'in', 'on', 'at', 'to', 'from',
    'by', 'of', 'new', 'hot', 'sale', 'best', 'cheap', 'original', 'official',
    'authentic', 'genuine', '2023', '2024', '2025', '2026', 'free', 'shipping',
    'fast', 'delivery', 'quality', 'high', 'pro', 'plus', 'max', 'mini',
    'ultra', 'super', 'premium', 'deluxe', 'advanced', 'standard', 'basic',
    'upgraded', 'improved', 'latest', 'version', 'edition', 'model'
  ]);
  
  // Split title into words
  const words = title.split(/\s+/).filter(w => w.length >= 2);
  
  // Filter out generic words, keep important ones
  const importantWords = [];
  for (const word of words) {
    const lower = word.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lower && !genericWords.has(lower) && importantWords.length < 12) {
      importantWords.push(word);
    }
  }
  
  // If we filtered too aggressively, use first 8 words
  if (importantWords.length < 5 && words.length >= 5) {
    return words.slice(0, 8).join(' ');
  }
  
  return importantWords.join(' ');
}

// ─── Search Strategy Builder ─────────────────────────────────────
/**
 * Build multiple search strategies from product title
 * Tries most specific keywords first, then progressively broader
 */
function buildSearchStrategies(title) {
  if (!title) return [{ name: 'generic', keywords: 'popular products' }];
  
  const words = title.split(/\s+/).filter(w => w.length >= 2);
  const strategies = [];
  
  // Strategy 1: Full title (most specific)
  const fullKeywords = extractSearchKeywords(title);
  if (fullKeywords) {
    strategies.push({ name: 'full_title', keywords: fullKeywords });
  }
  
  // Strategy 2: First 6 words (common pattern for product titles)
  if (words.length > 6) {
    const first6 = words.slice(0, 6).join(' ');
    strategies.push({ name: 'first_6_words', keywords: first6 });
  }
  
  // Strategy 3: Core product type (first 3-4 words usually contain the product type)
  if (words.length > 3) {
    const coreWords = words.slice(0, Math.min(4, words.length));
    // Remove obvious decorative words
    const cleaned = coreWords.filter(w => 
      !/^(the|a|an|and|with|for|new|hot|best|original)$/i.test(w)
    );
    if (cleaned.length >= 2) {
      strategies.push({ name: 'core_product', keywords: cleaned.join(' ') });
    }
  }
  
  // Strategy 4: Key product words only (nouns and important adjectives)
  const keyWords = extractKeyProductWords(title);
  if (keyWords && keyWords !== fullKeywords) {
    strategies.push({ name: 'key_words', keywords: keyWords });
  }
  
  // Strategy 5: Individual important words combined
  if (words.length >= 2) {
    // Take the 2 most important words (usually the product type)
    const importantWords = words
      .filter(w => w.length > 3)
      .filter(w => !/^(the|and|for|with|new|best|hot|original|authentic)$/i.test(w))
      .slice(0, 3);
    if (importantWords.length >= 2) {
      strategies.push({ name: 'important_words', keywords: importantWords.join(' ') });
    }
  }
  
  // Strategy 6: Just the most important noun phrases (product category)
  const categoryKeywords = detectProductCategory(title);
  if (categoryKeywords && categoryKeywords !== fullKeywords) {
    strategies.push({ name: 'category_only', keywords: categoryKeywords });
  }
  
  // Strategy 7: Last resort - first 2-3 words only
  if (words.length >= 2) {
    const minimal = words.slice(0, 3).join(' ');
    strategies.push({ name: 'minimal', keywords: minimal });
  }
  
  // Strategy 8: Single most important word (broadest category match)
  const mainProductWord = findMainProductWord(title);
  if (mainProductWord) {
    strategies.push({ name: 'main_word', keywords: mainProductWord });
  }
  
  return strategies;
}

/**
 * Extract key product words (nouns, product types)
 */
function extractKeyProductWords(title) {
  const words = title.split(/\s+/).filter(w => w.length >= 3);
  
  // Common product type patterns
  const productPatterns = [
    /\b(headphone|earphone|earbud|speaker|audio|sound|music|bluetooth|wireless|wired|stereo|bass|noise| cancelling|anc)\b/i,
    /\b(watch|smartwatch|clock|timepiece|digital|analog|sport|fitness|health)\b/i,
    /\b(phone|smartphone|mobile|cell|case|cover|screen|protector|charger|cable|adapter|power|battery)\b/i,
    /\b(laptop|computer|pc|notebook|tablet|ipad|keyboard|mouse|monitor|display|webcam|usb|hub)\b/i,
    /\b(camera|lens|tripod|flash|memory|sd|card|photography|video|action|gopro|drone|dji)\b/i,
    /\b(shoe|sneaker|boot|sandal|slipper|footwear|running|walking|casual|formal|sport|athletic)\b/i,
    /\b(bag|backpack|handbag|purse|wallet|luggage|suitcase|travel|tote|crossbody|shoulder)\b/i,
    /\b(dress|shirt|t-shirt|blouse|pants|jeans|skirt|jacket|coat|sweater|hoodie|clothing|apparel)\b/i,
    /\b(jewelry|necklace|bracelet|ring|earring|pendant|chain|gold|silver|diamond|crystal|pearl)\b/i,
    /\b(furniture|chair|table|desk|sofa|couch|bed|cabinet|shelf|bookcase|wardrobe|dresser|nightstand)\b/i,
    /\b(lamp|light|lighting|bulb|led|chandelier|pendant|floor|table|desk|ceiling)\b/i,
    /\b(decor|decoration|wall|art|picture|frame|mirror|vase|sculpture|statue|figurine)\b/i,
    /\b(kitchen|cook|cookware|pan|pot|knife|utensil|appliance|blender|mixer|coffee|tea|kettle)\b/i,
    /\b(tool|drill|saw|hammer|screwdriver|wrench|toolkit|repair|diy|hardware|mechanic)\b/i,
    /\b(toy|game|puzzle|lego|doll|action|figure|rc|remote|control|board|game|play|fun|educational)\b/i,
    /\b(chess|backgammon|checker|board\s*game|playing\s*card|puzzle|strategy|tactic)\b/i,
    /\b(sport|fitness|gym|exercise|workout|yoga|running|cycling|swimming|basketball|football|soccer)\b/i,
    /\b(beauty|makeup|cosmetic|skincare|perfume|lipstick|eyeshadow|foundation|cream|lotion)\b/i,
    /\b(health|massage|medical|therapy|vitamin|supplement|care|wellness|relax|pain|relief)\b/i,
    /\b(pet|dog|cat|animal|bird|fish|aquarium|food|toy|bed|collar|leash|grooming|care)\b/i,
    /\b(car|auto|vehicle|motorcycle|automotive|tire|wheel|accessory|part|interior|exterior)\b/i,
    /\b(baby|infant|toddler|diaper|stroller|clothing|care|maternity|feeding|bottle|pacifier)\b/i,
    /\b(office|stationery|pen|pencil|notebook|paper|printer|ink|supply|organizer|desk)\b/i,
    /\b(storage|organizer|container|box|basket|bin|rack|shelf|closet|drawer|space|saver)\b/i
  ];
  
  // Find matching words
  const matchedWords = [];
  for (const pattern of productPatterns) {
    const match = title.match(pattern);
    if (match) {
      matchedWords.push(match[0]);
    }
  }
  
  // Also add any words longer than 4 chars that aren't generic
  const genericWords = new Set([
    'original', 'authentic', 'genuine', 'official', 'premium', 'deluxe', 'luxury',
    'brand', 'new', 'hot', 'best', 'top', 'quality', 'high', 'pro', 'plus',
    '2023', '2024', '2025', '2026', 'edition', 'version', 'model', 'style',
    'sale', 'discount', 'cheap', 'affordable', 'expensive', 'price', 'cost',
    'fast', 'quick', 'express', 'shipping', 'delivery', 'free', 'worldwide',
    'amazon', 'aliexpress', 'ebay', 'walmart', 'target', 'shop', 'store'
  ]);
  
  for (const word of words) {
    const lower = word.toLowerCase();
    if (!genericWords.has(lower) && word.length >= 4) {
      matchedWords.push(word);
    }
  }
  
  // Remove duplicates and limit to most important
  const unique = [...new Set(matchedWords)];
  return unique.slice(0, 6).join(' ');
}

/**
 * Find the single most important product word
 */
function findMainProductWord(title) {
  const lower = title.toLowerCase();
  
  // Priority list of main product categories
  const mainCategories = [
    // Electronics
    { word: 'headphone', patterns: [/headphone/, /earphone/, /earbud/, /headset/] },
    { word: 'speaker', patterns: [/speaker/, /bluetooth speaker/, /subwoofer/] },
    { word: 'charger', patterns: [/charger/, /charging/, /power bank/] },
    { word: 'cable', patterns: [/cable/, /usb cable/, /charging cable/] },
    { word: 'phone case', patterns: [/phone case/, /case for/, /cover for/] },
    { word: 'smartwatch', patterns: [/smartwatch/, /smart watch/, /fitness watch/] },
    { word: 'laptop', patterns: [/laptop/, /notebook/, /computer/] },
    { word: 'camera', patterns: [/camera/, /webcam/, /action camera/, /gopro/] },
    { word: 'mouse', patterns: [/mouse/, /computer mouse/] },
    { word: 'keyboard', patterns: [/keyboard/, /mechanical keyboard/] },
    // Fashion
    { word: 'watch', patterns: [/watch/, /wristwatch/, /timepiece/] },
    { word: 'sunglasses', patterns: [/sunglass/, /sun glass/, /eyewear/] },
    { word: 'shoes', patterns: [/shoe/, /sneaker/, /footwear/, /boots/] },
    { word: 'bag', patterns: [/bag/, /backpack/, /handbag/, /purse/] },
    { word: 'jewelry', patterns: [/jewelry/, /jewellery/, /necklace/, /bracelet/] },
    // Home
    { word: 'furniture', patterns: [/furniture/, /chair/, /table/, /desk/, /sofa/] },
    { word: 'lamp', patterns: [/lamp/, /light/, /lighting/, /bulb/] },
    { word: 'clock', patterns: [/clock/, /wall clock/, /alarm clock/] },
    { word: 'mirror', patterns: [/mirror/, /wall mirror/, /vanity mirror/] },
    { word: 'curtains', patterns: [/curtain/, /drape/, /window curtain/] },
    // Kitchen
    { word: 'cookware', patterns: [/cookware/, /pot/, /pan/, /cooking/] },
    { word: 'knife', patterns: [/knife/, /kitchen knife/, /chef knife/] },
    { word: 'coffee', patterns: [/coffee/, /espresso/, /coffee maker/] },
    // Sports
    { word: 'yoga', patterns: [/yoga/, /yoga mat/, /yoga ball/] },
    { word: 'fitness', patterns: [/fitness/, /gym/, /exercise/, /workout/] },
    // Games
    { word: 'chess', patterns: [/chess/, /chess board/, /chess set/] },
    { word: 'backgammon', patterns: [/backgammon/, /backgammon board/] },
    { word: 'board game', patterns: [/board game/, /boardgame/, /table game/] },
    { word: 'puzzle', patterns: [/puzzle/, /jigsaw/, /puzzle game/] },
    { word: 'toy', patterns: [/toy/, /toys/, /educational toy/] },
    // Beauty
    { word: 'makeup', patterns: [/makeup/, /cosmetic/, /beauty/] },
    { word: 'skincare', patterns: [/skincare/, /skin care/, /facial/] },
    // Health
    { word: 'massage', patterns: [/massage/, /massager/, /therapy/] },
    // Tools
    { word: 'tools', patterns: [/tool/, /tools/, /toolkit/, /tool set/] },
    { word: 'drill', patterns: [/drill/, /electric drill/, /power drill/] },
    // Automotive
    { word: 'car accessories', patterns: [/car accessory/, /auto accessory/, /vehicle/] },
    // Baby
    { word: 'baby products', patterns: [/baby/, /infant/, /toddler/, /maternity/] },
    // Pet
    { word: 'pet supplies', patterns: [/pet/, /dog/, /cat/, /pet supply/] },
    // Storage
    { word: 'storage', patterns: [/storage/, /organizer/, /container/, /box/] }
  ];
  
  for (const category of mainCategories) {
    for (const pattern of category.patterns) {
      if (pattern.test(lower)) {
        return category.word;
      }
    }
  }
  
  // Fallback: return first significant word
  const words = title.split(/\s+/).filter(w => w.length >= 4);
  const skipWords = new Set(['original', 'authentic', 'official', 'premium', 'deluxe', 'luxury', 'brand', 'new', 'hot', 'best', 'top', 'quality', 'high', 'pro', 'plus']);
  
  for (const word of words) {
    if (!skipWords.has(word.toLowerCase())) {
      return word;
    }
  }
  
  return words[0] || 'product';
}

/**
 * Generate synonym-based alternative searches
 * Helps find products when exact match doesn't work
 */
function generateSynonymSearches(title) {
  const lower = title.toLowerCase();
  const searches = [];
  
  // Board games synonyms
  if (/\b(chess|backgammon|checker|board game|boardgame)\b/.test(lower)) {
    searches.push(
      { name: 'board_games', keywords: 'board games' },
      { name: 'table_games', keywords: 'table games' },
      { name: 'strategy_games', keywords: 'strategy games' },
      { name: 'classic_games', keywords: 'classic games' },
      { name: 'puzzle_games', keywords: 'puzzle games' },
      { name: 'family_games', keywords: 'family games' },
      { name: 'chess_set', keywords: 'chess set' },
      { name: 'chess_board', keywords: 'chess board' },
      { name: 'game_set', keywords: 'game set' }
    );
  }
  
  // Electronics synonyms
  if (/\b(headphone|earphone|earbud|headset)\b/.test(lower)) {
    searches.push(
      { name: 'audio', keywords: 'audio headphones' },
      { name: 'earphones', keywords: 'earphones' },
      { name: 'headset', keywords: 'headset' },
      { name: 'wireless_audio', keywords: 'wireless audio' }
    );
  }
  
  if (/\b(speaker|bluetooth speaker|audio|sound)\b/.test(lower)) {
    searches.push(
      { name: 'speakers', keywords: 'bluetooth speakers' },
      { name: 'audio', keywords: 'audio speakers' },
      { name: 'sound', keywords: 'sound system' },
      { name: 'portable_audio', keywords: 'portable audio' }
    );
  }
  
  if (/\b(phone case|phone cover|case for|protective case)\b/.test(lower)) {
    searches.push(
      { name: 'phone_accessories', keywords: 'phone accessories' },
      { name: 'phone_protection', keywords: 'phone protection' },
      { name: 'mobile_case', keywords: 'mobile case' }
    );
  }
  
  if (/\b(charger|charging|power bank|adapter|usb)\b/.test(lower)) {
    searches.push(
      { name: 'charging', keywords: 'phone charging' },
      { name: 'power', keywords: 'power bank' },
      { name: 'usb', keywords: 'usb charger' },
      { name: 'accessories', keywords: 'phone accessories' }
    );
  }
  
  if (/\b(watch|smartwatch|smart watch|fitness watch)\b/.test(lower)) {
    searches.push(
      { name: 'smartwatch', keywords: 'smartwatch' },
      { name: 'watches', keywords: 'digital watches' },
      { name: 'fitness_tracker', keywords: 'fitness tracker' },
      { name: 'wearable', keywords: 'wearable devices' }
    );
  }
  
  // Fashion synonyms
  if (/\b(shoe|sneaker|footwear|boot|sandal)\b/.test(lower)) {
    searches.push(
      { name: 'footwear', keywords: 'men shoes' },
      { name: 'sneakers', keywords: 'sneakers' },
      { name: 'casual_shoes', keywords: 'casual shoes' },
      { name: 'sport_shoes', keywords: 'sport shoes' }
    );
  }
  
  if (/\b(bag|backpack|handbag|purse|luggage)\b/.test(lower)) {
    searches.push(
      { name: 'bags', keywords: 'bags' },
      { name: 'backpacks', keywords: 'backpacks' },
      { name: 'travel_bag', keywords: 'travel bags' },
      { name: 'fashion_bag', keywords: 'fashion bags' }
    );
  }
  
  if (/\b(jewelry|jewellery|necklace|bracelet|ring|earring)\b/.test(lower)) {
    searches.push(
      { name: 'jewelry', keywords: 'jewelry' },
      { name: 'fashion_jewelry', keywords: 'fashion jewelry' },
      { name: 'accessories', keywords: 'fashion accessories' },
      { name: 'women_jewelry', keywords: 'women jewelry' }
    );
  }
  
  // Home synonyms
  if (/\b(furniture|chair|table|desk|sofa|couch|bed|shelf|cabinet)\b/.test(lower)) {
    searches.push(
      { name: 'furniture', keywords: 'home furniture' },
      { name: 'home_decor', keywords: 'home decor' },
      { name: 'living_room', keywords: 'living room furniture' },
      { name: 'bedroom', keywords: 'bedroom furniture' }
    );
  }
  
  if (/\b(lamp|light|lighting|bulb|led|chandelier)\b/.test(lower)) {
    searches.push(
      { name: 'lighting', keywords: 'home lighting' },
      { name: 'led_lights', keywords: 'led lights' },
      { name: 'decorative_light', keywords: 'decorative lighting' },
      { name: 'indoor_light', keywords: 'indoor lighting' }
    );
  }
  
  if (/\b(decor|decoration|wall art|frame|mirror|vase)\b/.test(lower)) {
    searches.push(
      { name: 'decor', keywords: 'home decor' },
      { name: 'wall_decor', keywords: 'wall decor' },
      { name: 'decoration', keywords: 'home decoration' },
      { name: 'interior', keywords: 'interior decor' }
    );
  }
  
  // Kitchen synonyms
  if (/\b(kitchen|cook|cookware|pan|pot|utensil|appliance|coffee|tea)\b/.test(lower)) {
    searches.push(
      { name: 'kitchen', keywords: 'kitchen accessories' },
      { name: 'cookware', keywords: 'cookware' },
      { name: 'cooking', keywords: 'cooking tools' },
      { name: 'dining', keywords: 'dining kitchen' }
    );
  }
  
  // Tools synonyms
  if (/\b(tool|drill|saw|hammer|screwdriver|repair|diy|hardware)\b/.test(lower)) {
    searches.push(
      { name: 'tools', keywords: 'hand tools' },
      { name: 'power_tools', keywords: 'power tools' },
      { name: 'diy', keywords: 'diy tools' },
      { name: 'repair', keywords: 'repair tools' }
    );
  }
  
  // Sports synonyms
  if (/\b(sport|fitness|gym|exercise|workout|yoga|running|cycling)\b/.test(lower)) {
    searches.push(
      { name: 'fitness', keywords: 'fitness equipment' },
      { name: 'gym', keywords: 'gym accessories' },
      { name: 'sports', keywords: 'sports equipment' },
      { name: 'exercise', keywords: 'exercise equipment' }
    );
  }
  
  // Beauty synonyms
  if (/\b(beauty|makeup|cosmetic|skincare|perfume|lipstick|eyeshadow|foundation|cream)\b/.test(lower)) {
    searches.push(
      { name: 'makeup', keywords: 'makeup cosmetics' },
      { name: 'skincare', keywords: 'skincare products' },
      { name: 'beauty', keywords: 'beauty products' },
      { name: 'personal_care', keywords: 'personal care' }
    );
  }
  
  // Health synonyms
  if (/\b(health|massage|medical|therapy|vitamin|supplement|wellness)\b/.test(lower)) {
    searches.push(
      { name: 'health', keywords: 'health products' },
      { name: 'massage', keywords: 'massage equipment' },
      { name: 'wellness', keywords: 'wellness products' },
      { name: 'medical', keywords: 'medical supplies' }
    );
  }
  
  // Pet synonyms
  if (/\b(pet|dog|cat|animal|bird|fish|aquarium|food|toy|bed)\b/.test(lower)) {
    searches.push(
      { name: 'pet', keywords: 'pet supplies' },
      { name: 'dog', keywords: 'dog accessories' },
      { name: 'cat', keywords: 'cat accessories' },
      { name: 'pet_care', keywords: 'pet care' }
    );
  }
  
  // Baby synonyms
  if (/\b(baby|infant|toddler|diaper|stroller|feeding|maternity)\b/.test(lower)) {
    searches.push(
      { name: 'baby', keywords: 'baby products' },
      { name: 'baby_care', keywords: 'baby care' },
      { name: 'baby_gear', keywords: 'baby gear' },
      { name: 'maternity', keywords: 'maternity baby' }
    );
  }
  
  // Automotive synonyms
  if (/\b(car|auto|vehicle|motorcycle|automotive|tire|wheel|accessory)\b/.test(lower)) {
    searches.push(
      { name: 'car', keywords: 'car accessories' },
      { name: 'auto', keywords: 'automotive accessories' },
      { name: 'car_interior', keywords: 'car interior' },
      { name: 'car_care', keywords: 'car care' }
    );
  }
  
  // Storage synonyms
  if (/\b(storage|organizer|container|box|basket|bin|rack|shelf|closet)\b/.test(lower)) {
    searches.push(
      { name: 'storage', keywords: 'storage organization' },
      { name: 'organizer', keywords: 'home organizer' },
      { name: 'containers', keywords: 'storage containers' },
      { name: 'space_saver', keywords: 'space saver' }
    );
  }
  
  // Office synonyms
  if (/\b(office|stationery|pen|pencil|notebook|desk|school|supply)\b/.test(lower)) {
    searches.push(
      { name: 'office', keywords: 'office supplies' },
      { name: 'stationery', keywords: 'stationery' },
      { name: 'school', keywords: 'school supplies' },
      { name: 'desk', keywords: 'desk accessories' }
    );
  }
  
  // Toys synonyms
  if (/\b(toy|game|play|educational|kids|children|fun|entertainment)\b/.test(lower)) {
    searches.push(
      { name: 'toys', keywords: 'toys games' },
      { name: 'kids_toys', keywords: 'kids toys' },
      { name: 'educational', keywords: 'educational toys' },
      { name: 'children', keywords: 'children toys' }
    );
  }
  
  return searches;
}

/**
 * Detect product category from title for fallback search
 */
function detectProductCategory(title) {
  const lower = title.toLowerCase();
  
  // Electronics
  if (/\b(headphone|earphone|speaker|bluetooth|charger|cable|phone|case|watch|laptop|tablet|camera|drone|mouse|keyboard|monitor|tv|adapter|power\s*bank)\b/.test(lower)) {
    return 'electronics accessories';
  }
  
  // Audio specifically
  if (/\b(audio|headphone|earbud|earphone|headset|speaker|microphone|sound|music|mp3|bluetooth\s*speaker)\b/.test(lower)) {
    return 'audio headphones speaker';
  }
  
  // Fashion - Clothing
  if (/\b(dress|shirt|t-shirt|pants|jeans|skirt|jacket|coat|sweater|suit|clothing|apparel|wear)\b/.test(lower)) {
    return 'clothing fashion';
  }
  
  // Fashion - Shoes
  if (/\b(shoe|sneaker|boot|sandal|slipper|footwear|running\s*shoe|casual\s*shoe)\b/.test(lower)) {
    return 'shoes footwear';
  }
  
  // Fashion - Accessories
  if (/\b(watch|sunglass|jewelry|necklace|bracelet|ring|earring|bag|handbag|backpack|wallet|belt|hat|cap|scarf)\b/.test(lower)) {
    return 'fashion accessories';
  }
  
  // Home & Garden - Furniture
  if (/\b(furniture|chair|table|desk|sofa|couch|bed|cabinet|shelf|bookcase|wardrobe|dresser|nightstand)\b/.test(lower)) {
    return 'furniture home';
  }
  
  // Home & Garden - Decor
  if (/\b(clock|lamp|light|lighting|decor|decoration|vase|mirror|frame|candle|pillow|cushion|curtain|rug|carpet)\b/.test(lower)) {
    return 'home decor';
  }
  
  // Kitchen
  if (/\b(kitchen|cook| cookware|pan|pot|knife|utensil|plate|bowl|cup|mug|appliance|blender|mixer|coffee|tea)\b/.test(lower)) {
    return 'kitchen cookware';
  }
  
  // Sports
  if (/\b(sport|fitness|gym|yoga|running|cycling|swimming|basketball|football|soccer|tennis|exercise|workout|ball)\b/.test(lower)) {
    return 'sports fitness';
  }
  
  // Toys & Games
  if (/\b(toy|game|puzzle|lego|doll|action\s*figure|rc\s*car|board\s*game|chess|backgammon|playing\s*cards)\b/.test(lower)) {
    return 'toys games';
  }
  
  // Games specifically (chess, backgammon, etc.)
  if (/\b(chess|backgammon|checker|board\s*game|puzzle|game\s*set)\b/.test(lower)) {
    return 'board games chess backgammon';
  }
  
  // Beauty
  if (/\b(makeup|cosmetic|beauty|skincare|perfume|lipstick|eyeshadow|foundation|cream|lotion|shampoo|hair)\b/.test(lower)) {
    return 'beauty makeup';
  }
  
  // Health
  if (/\b(health|massage|medical|therapy|vitamin|supplement|care|wellness|fitness\s*equipment)\b/.test(lower)) {
    return 'health wellness';
  }
  
  // Pet
  if (/\b(pet|dog|cat|animal|bird|fish|aquarium|pet\s*food|pet\s*toy|pet\s*bed)\b/.test(lower)) {
    return 'pet supplies';
  }
  
  // Tools
  if (/\b(tool|drill|saw|hammer|screwdriver|wrench|toolkit|repair|diy|hardware)\b/.test(lower)) {
    return 'tools hardware';
  }
  
  // Car
  if (/\b(car|auto|vehicle|motorcycle|tire|wheel|car\s*accessory|gps|car\s*care)\b/.test(lower)) {
    return 'automotive accessories';
  }
  
  // Baby
  if (/\b(baby|infant|toddler|diaper|stroller|baby\s*clothing|baby\s*care|maternity)\b/.test(lower)) {
    return 'baby products';
  }
  
  // Office
  if (/\b(office|stationery|pen|pencil|notebook|paper|printer|ink|desk\s*accessory)\b/.test(lower)) {
    return 'office supplies';
  }
  
  // Storage/Organization
  if (/\b(storage|organizer|container|box|basket|bin|rack|shelf|wardrobe\s*organizer)\b/.test(lower)) {
    return 'storage organization';
  }
  
  // Default - extract main nouns from first 4 words
  const words = title.split(/\s+/).slice(0, 4);
  return words.join(' ');
}

// ─── Relevance Scoring ──────────────────────────────────────────
/**
 * Build a token bag from the user's query.
 * Returns an array of unique, lowercased tokens (≥2 chars, not stopwords).
 */
function buildQueryTokens(text) {
  const tokens = tokenize(text);
  const unique = [];
  const seen = new Set();
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }
  return unique;
}

// ─── Fetch Multiple Pages for Similar Products ──────────────────
// AliExpress limits to 50 per page, so we fetch multiple pages to get up to 1000
async function fetchMultiplePages({ keywords, maxResults, productId, aliLang, currency }) {
  const allProducts = [];
  const seenIds = new Set();
  const maxPages = Math.ceil(Math.min(maxResults, 1000) / 50); // Max 20 pages
  
  console.log('[Similar] Fetching', maxPages, 'pages to get', maxResults, 'products');
  
  for (let page = 1; page <= maxPages; page++) {
    if (allProducts.length >= maxResults) break;
    
    try {
      const searchParams = {
        app_key: APP_KEY,
        timestamp: getChinaTimestamp(),
        method: 'aliexpress.affiliate.product.query',
        sign_method: 'md5',
        v: '2.0',
        keyWord: keywords,
        page_no: String(page),
        page_size: '50', // Max allowed by AliExpress
        target_currency: currency,
        target_language: aliLang,
        tracking_id: TRACKING_ID
      };

      searchParams.sign = generateSignature(searchParams, APP_SECRET);

      const searchQuery = Object.keys(searchParams)
        .sort((a, b) => a.localeCompare(b))
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(searchParams[k])}`)
        .join('&');

      const searchResponse = await fetch(`${API_GATEWAY}?${searchQuery}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });

      if (!searchResponse.ok) {
        console.log('[Similar] Page', page, 'HTTP error:', searchResponse.status);
        continue;
      }

      const searchData = await searchResponse.json();
      if (searchData.error_response) {
        console.log('[Similar] Page', page, 'API error:', searchData.error_response.msg);
        continue;
      }

      const result = searchData.aliexpress_affiliate_product_query_response;
      const list = result?.resp_result?.result?.products?.product
                || result?.products?.product
                || [];

      if (list && list.length > 0) {
        const products = Array.isArray(list) ? list : [list];
        
        // Add unique products (not the original productId)
        for (const p of products) {
          const pid = String(p.product_id);
          if (pid !== String(productId) && !seenIds.has(pid)) {
            seenIds.add(pid);
            allProducts.push(p);
            if (allProducts.length >= maxResults) break;
          }
        }
        
        console.log('[Similar] Page', page, 'found', products.length, 'products, total unique:', allProducts.length);
        
        // If page returned less than 50, no more pages available
        if (products.length < 50) {
          console.log('[Similar] Last page reached at page', page);
          break;
        }
      } else {
        console.log('[Similar] No products on page', page);
        break;
      }
      
      // Small delay between pages to avoid rate limiting
      if (page < maxPages) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err) {
      console.log('[Similar] Error on page', page, ':', err.message);
    }
  }
  
  console.log('[Similar] Total unique products fetched:', allProducts.length);
  return allProducts;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Returns 0–100 relevance score with weighted tokens:
 * - High weight (25 points): brand/model tokens (>=4 chars, specific)
 * - Medium weight (15 points): product type (microphone, mic, headset)
 * - Low weight (8 points): generic features (usb, gaming, wireless)
 * Requires at least one high-weight match for decent relevance.
 */
function calcRelevance(queryTokens, title) {
  if (!queryTokens.length || !title) return 0;
  const t = title.toLowerCase();
  const titleTokens = new Set(tokenize(t));
  
  // Define token weights based on specificity
  const genericWords = new Set(['usb', 'gaming', 'wireless', 'bluetooth', 'digital', 'portable', 'new', 'original', 'official']);
  const productTypes = new Set(['microphone', 'mic', 'mics', 'headset', 'headphone', 'earphone', 'earbud', 'speaker']);
  
  let weightedScore = 0;
  let maxPossibleScore = 0;
  let hasBrandMatch = false;
  
  for (const q of queryTokens) {
    if (!titleTokens.has(q)) continue;
    
    // Determine token weight
    let weight;
    if (genericWords.has(q)) {
      weight = 8;  // Generic features - low weight
    } else if (productTypes.has(q)) {
      weight = 20; // Product category - high weight
    } else if (q.length >= 4) {
      weight = 25; // Brand/model names (longer, specific) - highest weight
      hasBrandMatch = true;
    } else {
      weight = 15; // Other tokens - medium weight
    }
    
    weightedScore += weight;
    maxPossibleScore += 25; // Normalize against max possible
  }
  
  // Convert to 0-100 scale
  let score = maxPossibleScore > 0 ? (weightedScore / maxPossibleScore) * 100 : 0;
  
  // Bonus: title starts with first query token (likely the brand)
  if (queryTokens[0] && t.startsWith(queryTokens[0])) score += 10;
  
  // Bonus: adjacent phrase match
  for (let i = 0; i < queryTokens.length - 1; i++) {
    const phrase = `${queryTokens[i]} ${queryTokens[i + 1]}`;
    if (t.includes(phrase)) { score += 15; break; }
  }
  
  // Penalty: if no brand/model match and score is low, reduce further
  if (!hasBrandMatch && score < 40) {
    score = score * 0.5; // Heavy penalty for generic matches only
  }

  return Math.min(100, Math.round(score * 10) / 10);
}

// ─── Trust Scoring ──────────────────────────────────────────────
function calcTrust(p, maxSales) {
  const ratingNorm = (Number(p.rating) || 0) / 5 * 100;
  const salesNorm = maxSales > 0 ? Math.min((p.totalSales / maxSales) * 100, 100) : 0;
  const score = 0.6 * ratingNorm + 0.4 * salesNorm;
  return Math.round(score * 10) / 10;
}

// ─── Normalization ──────────────────────────────────────────────
function normalizeProduct(p, fallbackCurrency) {
  const productId = p.product_id;
  const productUrl = p.product_detail_url;
  const cleanUrl = productUrl ? productUrl.split('?')[0] : `https://www.aliexpress.com/item/${productId}.html`;

  const salePriceStr = p.target_sale_price || p.sale_price || '';
  const originalPriceStr = p.target_original_price || p.original_price || '';
  const salePriceNum = Number.parseFloat(salePriceStr) || 0;
  const originalPriceNum = Number.parseFloat(originalPriceStr) || 0;
  const discountPct = (originalPriceNum > 0 && salePriceNum > 0)
    ? Math.round((1 - salePriceNum / originalPriceNum) * 1000) / 10
    : 0;

  const officialAffiliate = p.promotion_link || '';
  const affiliateLink = officialAffiliate || generateAffiliateLink(cleanUrl, productId);

  const storeId = p.seller_id || p.store_id || '';
  const storeUrl = storeId ? `https://www.aliexpress.com/store/${storeId}` : '';

  const imgUrl = p.product_main_image_url || '';
  
  return {
    productId,
    title: (p.product_title || '').substring(0, 200),
    price: salePriceStr,
    originalPrice: originalPriceStr,
    priceNumeric: salePriceNum,
    currency: p.target_original_price_currency || p.target_sale_price_currency || fallbackCurrency,
    imgUrl,                    // legacy field
    imageUrl: imgUrl,         // extension expects this field
    productUrl: cleanUrl,
    affiliateLink,
    rating: Number.parseFloat(p.evaluation_score) || null,
    totalSales: Number.parseInt(p.lastest_volume || p.sales) || 0,
    storeName: p.shop_name || '',
    storeId,
    storeUrl,
    discountPct,
    categoryId: p.category_id || '',
    commissionRate: p.commission_rate || ''
  };
}

function generateAffiliateLink(productUrl, productId) {
  if (productUrl) {
    return `https://s.click.aliexpress.com/deep_link.htm?aff_short_key=${TRACKING_ID}&dl_target_url=${encodeURIComponent(productUrl)}`;
  }
  return `https://s.click.aliexpress.com/e/_${TRACKING_ID}?item_id=${productId}`;
}

// ─── Signing ────────────────────────────────────────────────────
function generateSignature(params, secret) {
  const sortedKeys = Object.keys(params).sort((a, b) => a.localeCompare(b));
  let stringToSign = secret;
  for (const key of sortedKeys) stringToSign += key + params[key];
  stringToSign += secret;

  return crypto.createHash('md5')
    .update(stringToSign)
    .digest('hex')
    .toUpperCase();
}

// ─── Misc Helpers ───────────────────────────────────────────────
function extractTitleFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname;

    // Amazon-style: /Sony-WH-1000XM5-Headphones/dp/B09XS7JWHH
    // eBay-style: /itm/123/item-name
    // AliExpress: /item/100500123.html
    // Generic: extract slug before file extension or ID segments
    let slug = path
      .replace(/\/(dp|gp|itm|item|product|p)\/[A-Za-z0-9]+/g, '')
      .replace(/\.html?$/i, '')
      .replace(/^\//, '')
      .replace(/\/$/, '');

    // Take the longest path segment (usually the product name slug)
    const segments = slug.split('/').filter(Boolean);
    const sorted = segments.toSorted((a, b) => b.length - a.length);
    let best = sorted[0] || '';

    // Split camelCase / PascalCase
    best = best.replaceAll(/([a-z])([A-Z])/g, '$1 $2');

    // Replace hyphens, underscores, dots with spaces
    const keywords = best
      .replaceAll(/[-_.+]/g, ' ')
      .replaceAll(/\d{6,}/g, '') // Remove long numbers (product IDs)
      .replaceAll(/\s+/g, ' ')
      .trim();

    return keywords.length >= 3 ? keywords : null;
  } catch {
    return null;
  }
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
