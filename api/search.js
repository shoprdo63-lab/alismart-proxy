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
const APP_SECRET = process.env.ALI_APP_SECRET || 'YPhzjbGESFs75SniEK0t1wwfKhvrKIhq';
const TRACKING_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const API_GATEWAY = 'https://api-sg.aliexpress.com/sync';

const PAGE_SIZE = 50;                  // AliExpress hard cap is 50 / page
const MAX_RESULTS = 1000;              // hard ceiling on returned products
const DEFAULT_RESULTS = 50;            // when caller doesn't specify
const MAX_CANDIDATE_POOL = 10000;      // upper bound of items we ever fetch
const DEFAULT_CANDIDATE_POOL = 5000;   // sane default for relevance ranking
const FETCH_CONCURRENCY = 8;           // parallel API requests per wave
const RELEVANCE_THRESHOLD = 35;        // drop items scoring below this (0–100)

const SEARCH_CACHE_TTL = 1000 * 60 * 10;            // 10 minutes
const TRANSLATION_CACHE_TTL = 1000 * 60 * 60 * 24;  // 24 hours
const MAX_CACHE_ENTRIES = 500;

// Sort strategies fetched in parallel for diverse coverage
const SORT_STRATEGIES = ['LAST_VOLUME_DESC', 'SALE_PRICE_ASC', ''];
//   - LAST_VOLUME_DESC: best-sellers first (high-trust items)
//   - SALE_PRICE_ASC : cheapest first (price-sensitive shoppers)
//   - ''             : default = AliExpress relevance ranking

const RTL_LANGUAGES = new Set(['he', 'ar', 'ur', 'fa', 'yi']);

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

  const searchKeywords = (keywords || q || keyword || extractTitleFromUrl(productUrl || url) || '').trim();
  if (!searchKeywords) {
    return res.status(400).json({ error: 'Keywords or productUrl required' });
  }

  // Normalize input - use effectiveLanguage from locale if provided
  const userLang = effectiveLanguage.toLowerCase().split('-')[0];
  const aliLang = ALI_LANGUAGES[userLang] || 'EN';
  const userCurrency = currency.toUpperCase();
  const isRTL = RTL_LANGUAGES.has(userLang);

  const targetCount = clamp(toInt(maxResults, DEFAULT_RESULTS), 1, MAX_RESULTS);
  const poolSize = clamp(toInt(candidatePoolSize, DEFAULT_CANDIDATE_POOL), targetCount, MAX_CANDIDATE_POOL);
  const relevanceFloor = clamp(toInt(minRelevance, RELEVANCE_THRESHOLD), 0, 100);

  // Cache lookup
  const cacheKey = `s:${userLang}:${userCurrency}:${shipToCountry || 'GLOBAL'}:${targetCount}:${poolSize}:${relevanceFloor}:${searchKeywords}`;
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < SEARCH_CACHE_TTL)) {
    return res.status(200).json({ ...cached.data, cached: true, executionTimeMs: Date.now() - t0 });
  }

  try {
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

    // 6. Filter by relevance threshold, BUT if we don't have enough,
    // relax the threshold progressively until we have targetCount products
    let filtered = normalized.filter(p => p.relevanceScore >= relevanceFloor);

    // If not enough products pass the relevance threshold, relax it slightly
    // but NOT below 15 to maintain quality (avoid USB chargers when searching for mics)
    if (filtered.length < targetCount && normalized.length > 0) {
      // Try lower thresholds but stop at 15 minimum for quality
      const thresholds = [30, 25, 20, 15];
      for (const threshold of thresholds) {
        if (filtered.length >= targetCount) break;
        filtered = normalized.filter(p => p.relevanceScore >= threshold);
      }
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
    timestamp: new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
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
  return Array.isArray(list) ? list : [list];
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
