# API Guide for Chrome Extension Developer

## Server URL
```
https://alismart-api-v2.vercel.app
```

## Endpoint
```
GET  /api/search?q={keywords}&language={lang}&currency={cur}&shipToCountry={cc}&maxResults={N}&candidatePoolSize={M}
POST /api/search
```

Both work. Use GET for simple calls, POST for complex bodies.

---

## Request Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` or `keywords` | string | **Yes** | — | Search keywords or product title |
| `productUrl` or `url` | string | No | — | Instead of keywords, send a product URL and the server will extract keywords from it |
| `language` | string | No | `en` | User language code: `he`, `en`, `es`, `fr`, `de`, `ru`, `ar`, etc. |
| `currency` | string | No | `USD` | User currency: `ILS`, `USD`, `EUR`, `RUB`, `SAR`, etc. |
| `shipToCountry` | string | No | `US` | 2-letter country code for shipping: `IL`, `US`, `ES`, `FR`, etc. |
| `maxResults` | number | No | `50` | **Max 1000**. How many products to return. |
| `candidatePoolSize` | number | No | `2000` | **Max 10000**. How many products the server fetches from AliExpress before filtering. Higher = more accurate but slower. |
| `minRelevance` | number | No | `30` | Minimum relevance score (0-100). Products below this score are dropped. |
| `autoTranslate` | boolean | No | `true` | If `true` and language is not English, the server auto-translates keywords to English before searching AliExpress. |

---

## How It Works (Server Side)

1. **Translate** — If `language` is not English (e.g. `he`), the server translates the keywords to English first.
2. **Fetch candidates** — The server fetches up to `candidatePoolSize` products from AliExpress Affiliate API using multiple sort strategies (best match, top sales, lowest price).
3. **Deduplicate** — Removes duplicate products across pages.
4. **Score relevance** — Compares each product title to the search keywords (token matching + phrase bonuses).
5. **Score trust** — Looks at rating and total sales.
6. **Composite score** — `score = 0.7 * relevance + 0.3 * trust`.
7. **Filter & sort** — Drops products below `minRelevance`, sorts by composite score.
8. **Return top N** — Returns the best `maxResults` products.
9. **Cache** — Results are cached for 10 minutes. Same query = instant response.

---

## Example: Simple GET Request

```js
const SERVER = 'https://alismart-api-v2.vercel.app';

async function search(keywords) {
  const params = new URLSearchParams({
    q: keywords,
    language: 'he',
    currency: 'ILS',
    shipToCountry: 'IL',
    maxResults: '100',        // return 100 best products
    candidatePoolSize: '5000'  // scan 5000 candidates
  });

  const res = await fetch(`${SERVER}/api/search?${params}`);
  const data = await res.json();

  if (!data.success) {
    console.error('Search failed:', data.error);
    return [];
  }

  return data.products; // Array of products
}

// Usage
const products = await search('אוזניות בלוטות');
```

---

## Example: POST Request (more control)

```js
const res = await fetch(`${SERVER}/api/search`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    keywords: 'Sony WH-1000XM5',
    language: 'he',
    currency: 'ILS',
    shipToCountry: 'IL',
    maxResults: 1000,
    candidatePoolSize: 10000,
    minRelevance: 50
  })
});
const data = await res.json();
```

---

## Debugging & Troubleshooting

### Test the Server Directly

Before integrating, test that the server works:

```bash
# Test GET
curl "https://alismart-api-v2.vercel.app/api/search?q=headphones&language=en&currency=USD&maxResults=3"

# Test POST
curl -X POST "https://alismart-api-v2.vercel.app/api/search" \
  -H "Content-Type: application/json" \
  -d '{"keywords":"headphones","language":"en","currency":"USD","maxResults":3}'
```

### Common Issues & Solutions

| Problem | Cause | Solution |
|---------|-------|----------|
| `Method not allowed` error | Using wrong HTTP method | Use GET or POST only |
| `No products found` | Relevance threshold too high | Lower `minRelevance` to 10 or 0 |
| `Keywords required` error | Missing search terms | Send `q` or `keywords` parameter |
| CORS error in console | Missing host permission | Add server URL to `host_permissions` in manifest |
| Request times out | candidatePoolSize too high | Reduce to 2000 or less |
| Empty product array | API returned 0 candidates | Try different keywords or increase pool size |

### Extension Debugging Checklist

```js
async function debugSearch(keywords) {
  const url = `https://alismart-api-v2.vercel.app/api/search?q=${encodeURIComponent(keywords)}&language=en&maxResults=5`;
  
  console.log('Request URL:', url);
  
  try {
    const res = await fetch(url);
    console.log('Response status:', res.status, res.statusText);
    
    const data = await res.json();
    console.log('Full response:', data);
    
    if (!data.success) {
      console.error('API error:', data.error);
      return null;
    }
    
    if (data.count === 0) {
      console.warn('No products found. Pool size:', data.candidatePoolSize);
      console.warn('Try increasing candidatePoolSize or lowering minRelevance');
      return null;
    }
    
    console.log(`✅ Found ${data.count} products from ${data.candidatePoolSize} candidates`);
    return data.products;
    
  } catch (err) {
    console.error('Network error:', err.message);
    console.error('Stack:', err.stack);
    return null;
  }
}
```

### Quick Fixes for "No Results"

If the API returns `count: 0`, try these in order:

1. **Increase candidate pool** (fetch more candidates):
   ```js
   candidatePoolSize: 5000  // default is 2000
   ```

2. **Lower relevance threshold** (accept less similar products):
   ```js
   minRelevance: 10  // default is 25, try 0 to accept all
   ```

3. **Simplify keywords** (AliExpress search works better with simple terms):
   ```js
   // Instead of:
   keywords: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black"
   
   // Try:
   keywords: "wireless headphones"
   ```

4. **Use English keywords directly** (skip translation):
   ```js
   keywords: "bluetooth earphones",
   language: "en"  // force English
   ```

---

## Response Format

```json
{
  "success": true,
  "count": 847,
  "candidatePoolSize": 5000,
  "filteredCount": 1243,
  "droppedByRelevance": 3757,
  "language": "he",
  "currency": "ILS",
  "isRTL": true,
  "shipToCountry": "IL",
  "originalKeywords": "אוזניות בלוטות",
  "translatedKeywords": "bluetooth headphones",
  "fetchTimeMs": 2340,
  "executionTimeMs": 3450,
  "cached": false,
  "products": [
    {
      "productId": "1005008430168106",
      "title": "Bluetooth Headphones Wireless Over Ear...",
      "price": "12.99",
      "originalPrice": "29.99",
      "currency": "ILS",
      "discountPct": 56.7,
      "imgUrl": "https://ae01.alicdn.com/...jpg",
      "productUrl": "https://www.aliexpress.com/item/1005008430168106.html",
      "affiliateLink": "https://s.click.aliexpress.com/s/xxxxx",
      "commissionRate": "7.0%",
      "rating": 4.8,
      "totalSales": 15234,
      "storeName": "Tech Store",
      "storeUrl": "https://www.aliexpress.com/store/123456",
      "relevanceScore": 95.2,
      "trustScore": 78.4,
      "score": 90.2
    }
  ]
}
```

---

## Product Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `productId` | string | AliExpress product ID |
| `title` | string | Product title |
| `price` | string | Current sale price |
| `originalPrice` | string | Original price before discount (may be null) |
| `currency` | string | Currency code (ILS, USD, etc.) |
| `discountPct` | number | Discount percentage (0 if no discount) |
| `imgUrl` | string | Product image URL |
| `productUrl` | string | Direct AliExpress product page |
| `affiliateLink` | string | **Affiliate link. Always use this for clicks.** |
| `commissionRate` | string | Commission percentage (e.g. "7.0%") |
| `rating` | number | Product rating 0-5 |
| `totalSales` | number | Total units sold |
| `storeName` | string | Seller store name |
| `storeUrl` | string | Store page URL |
| `relevanceScore` | number | 0-100. How similar to search query |
| `trustScore` | number | 0-100. Based on rating + sales |
| `score` | number | 0-100. Composite = 0.7*relevance + 0.3*trust |

**Important:** Always redirect users through `affiliateLink`, not `productUrl`. The affiliate link includes your tracking ID and earns commission.

---

## Error Responses

```json
// Missing keywords
{ "error": "Keywords or productUrl required" }

// Server error
{ "success": false, "error": "Failed to fetch products", "message": "..." }

// Method not allowed (only GET/POST)
{ "error": "Method not allowed" }
```

---

## Extension Integration Checklist

### manifest.json
```json
{
  "manifest_version": 3,
  "name": "AliSmart Finder",
  "version": "1.0",
  "permissions": ["activeTab"],
  "host_permissions": [
    "https://alismart-api-v2.vercel.app/*"
  ],
  "action": {
    "default_popup": "popup.html"
  }
}
```

**Do NOT** add `aliexpress.com` to `host_permissions`. The extension must NOT call AliExpress directly. All traffic goes through your server.

### Detect User Locale
```js
function getUserLocale() {
  const lang = navigator.language; // "he-IL", "en-US"
  const code = lang.split('-')[0];

  const map = {
    he: { language: 'he', currency: 'ILS', shipToCountry: 'IL' },
    en: { language: 'en', currency: 'USD', shipToCountry: 'US' },
    es: { language: 'es', currency: 'EUR', shipToCountry: 'ES' },
    fr: { language: 'fr', currency: 'EUR', shipToCountry: 'FR' },
    de: { language: 'de', currency: 'EUR', shipToCountry: 'DE' },
    ru: { language: 'ru', currency: 'RUB', shipToCountry: 'RU' },
    ar: { language: 'ar', currency: 'SAR', shipToCountry: 'SA' },
    ja: { language: 'ja', currency: 'JPY', shipToCountry: 'JP' },
    ko: { language: 'ko', currency: 'KRW', shipToCountry: 'KR' },
    pt: { language: 'pt', currency: 'BRL', shipToCountry: 'BR' },
    tr: { language: 'tr', currency: 'TRY', shipToCountry: 'TR' },
  };

  return map[code] || map.en;
}
```

### Search from Current Page (Content Script)
```js
// content.js — runs on product pages
const title = document.title.replace(/\|.*$/,'').trim(); // clean Amazon suffix

chrome.runtime.sendMessage({
  action: 'search',
  keywords: title
});
```

### Popup — Full Example
```js
// popup.js
const SERVER = 'https://alismart-api-v2.vercel.app';

async function searchFromPage() {
  // 1. Get active tab title
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const keywords = tab.title.replace(/\|.*$/,'').trim();

  // 2. Detect locale
  const locale = getUserLocale();
  const isRTL = ['he','ar','ur','fa'].includes(locale.language);

  // 3. Show loading
  document.getElementById('results').innerHTML = '<div class="loading">Searching...</div>';

  // 4. Call server
  const params = new URLSearchParams({
    q: keywords,
    language: locale.language,
    currency: locale.currency,
    shipToCountry: locale.shipToCountry,
    maxResults: '100',
    candidatePoolSize: '5000'
  });

  const res = await fetch(`${SERVER}/api/search?${params}`);
  const data = await res.json();

  // 5. Render
  if (data.success && data.count > 0) {
    renderProducts(data.products, locale, isRTL);
  } else {
    showError(data.error || 'No products found');
  }
}

function renderProducts(products, locale, isRTL) {
  const container = document.getElementById('results');
  container.style.direction = isRTL ? 'rtl' : 'ltr';
  container.innerHTML = '';

  // Optional: show translation info
  if (data.translatedKeywords) {
    const info = document.createElement('div');
    info.className = 'translation-info';
    info.textContent = `Translated: "${data.translatedKeywords}"`;
    container.appendChild(info);
  }

  for (const p of products) {
    const card = document.createElement('div');
    card.className = 'product-card';

    const hasDiscount = p.originalPrice && p.discountPct > 0;

    card.innerHTML = `
      <img src="${p.imgUrl}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="info">
        <h3>${escapeHtml(p.title)}</h3>
        <div class="price">
          ${hasDiscount ? `<del>${p.originalPrice} ${p.currency}</del> ` : ''}
          <strong>${p.price} ${p.currency}</strong>
          ${hasDiscount ? `<span class="discount">-${Math.round(p.discountPct)}%</span>` : ''}
        </div>
        <div class="meta">
          ${p.rating ? `⭐ ${p.rating.toFixed(1)}` : ''}
          ${p.totalSales ? `· ${p.totalSales.toLocaleString()} sold` : ''}
          ${p.commissionRate ? `· <span class="commission">${p.commissionRate}</span>` : ''}
        </div>
        ${p.relevanceScore ? `<div class="score">Match: ${p.relevanceScore}%</div>` : ''}
        <a href="${p.affiliateLink}" target="_blank" rel="noopener" class="buy-btn">
          ${isRTL ? 'קנה עכשיו' : 'Buy Now'}
        </a>
      </div>
    `;

    container.appendChild(card);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Run on popup open
document.addEventListener('DOMContentLoaded', searchFromPage);
```

---

## Important Notes

1. **Always use `affiliateLink`** — never `productUrl`. The affiliate link tracks sales and pays commission.

2. **GET is backward compatible** — if you have an existing extension doing `fetch('/api/search?q=...')`, it will work without changes.

3. **POST is for complex data** — use POST when sending JSON body with many parameters.

4. **RTL support** — The server returns `isRTL: true` for Hebrew (`he`) and Arabic (`ar`). Use this to set `direction: rtl` in your CSS.

5. **Translation** — The server auto-translates non-English keywords. It returns both `originalKeywords` and `translatedKeywords` in the response.

6. **Caching** — Same query is cached for 10 minutes on the server. You'll see `"cached": true` in the response.

7. **Rate limits** — Don't call the API in a tight loop. Batch requests or use debounce (e.g. 300ms after user stops typing).

8. **Max values** —
   - `maxResults`: up to 1000
   - `candidatePoolSize`: up to 10000
   - Higher values = slower response. For popup UI, 50-100 products is usually enough.

9. **Error handling** — Always check `res.ok` and `data.success`. Network can fail, API can timeout.

10. **Image loading** — Use `loading="lazy"` on images and handle `onerror` (some AliExpress images may be blocked by CSP).

---

## Testing URLs

Test in browser:
```
https://alismart-api-v2.vercel.app/api/search?q=keyboard&language=en&currency=USD&maxResults=5
```

Test from extension console:
```js
fetch('https://alismart-api-v2.vercel.app/api/search?q=headphones&language=he&currency=ILS&maxResults=3')
  .then(r => r.json())
  .then(d => console.log(d.products.length, 'products'));
```
