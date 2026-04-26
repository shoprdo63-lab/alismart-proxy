# Extension Integration Guide — Worldwide AliExpress Search

Copy these snippets directly into your Chrome Extension (popup / background / content script).

---

## 1. Detect User Locale

```js
// popup.js or background.js

function getUserLocale() {
  const lang = navigator.language;          // "he-IL", "es-ES", "fr-FR"
  const langCode = lang.split('-')[0];      // "he", "es", "fr"

  // Map language to default currency & ship-to country
  const DEFAULTS = {
    he: { currency: 'ILS', shipToCountry: 'IL' },
    en: { currency: 'USD', shipToCountry: 'US' },
    es: { currency: 'EUR', shipToCountry: 'ES' },
    fr: { currency: 'EUR', shipToCountry: 'FR' },
    de: { currency: 'EUR', shipToCountry: 'DE' },
    it: { currency: 'EUR', shipToCountry: 'IT' },
    ru: { currency: 'RUB', shipToCountry: 'RU' },
    pt: { currency: 'BRL', shipToCountry: 'BR' },
    ja: { currency: 'JPY', shipToCountry: 'JP' },
    ko: { currency: 'KRW', shipToCountry: 'KR' },
    ar: { currency: 'SAR', shipToCountry: 'SA' },
    tr: { currency: 'TRY', shipToCountry: 'TR' },
    id: { currency: 'IDR', shipToCountry: 'ID' },
    vi: { currency: 'VND', shipToCountry: 'VN' },
    mx: { currency: 'MXN', shipToCountry: 'MX' },
    cl: { currency: 'CLP', shipToCountry: 'CL' },
    // Add more as needed
  };

  const defaults = DEFAULTS[langCode] || { currency: 'USD', shipToCountry: 'US' };

  return {
    language: langCode,
    currency: defaults.currency,
    shipToCountry: defaults.shipToCountry,
    isRTL: ['he', 'ar', 'ur', 'fa'].includes(langCode)
  };
}
```

---

## 2. Search Products (Call the Server)

```js
const SERVER_URL = 'https://alismart-api-v2.vercel.app'; // Your deployed server

async function searchAliExpress(keywords, maxResults = 50) {
  const locale = getUserLocale();

  const res = await fetch(`${SERVER_URL}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords,
      language: locale.language,
      currency: locale.currency,
      shipToCountry: locale.shipToCountry,
      maxResults
    })
  });

  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }

  return res.json(); // { success, count, products[], language, currency, isRTL }
}
```

---

## 3. Render Results (RTL-aware)

```js
function renderProducts(response, container) {
  const { products, isRTL, currency } = response;

  container.style.direction = isRTL ? 'rtl' : 'ltr';
  container.innerHTML = '';

  for (const p of products) {
    const card = document.createElement('div');
    card.className = 'product-card';

    // Price display
    const priceText = p.originalPrice
      ? `<span class="original-price">${p.originalPrice} ${currency}</span>
         <span class="sale-price">${p.price} ${currency}</span>
         <span class="discount">-${p.discountPct}%</span>`
      : `<span class="price">${p.price} ${currency}</span>`;

    // Rating
    const ratingText = p.rating
      ? `⭐ ${p.rating} (${p.totalSales.toLocaleString()} sold)`
      : '';

    card.innerHTML = `
      <img src="${p.imgUrl}" alt="${p.title}" loading="lazy">
      <div class="info">
        <h3>${escapeHtml(p.title)}</h3>
        <div class="price-row">${priceText}</div>
        <div class="meta">${ratingText}</div>
        <a href="${p.affiliateLink}" target="_blank" rel="noopener">
          ${isRTL ? 'לקנייה באלי אקספרס' : 'Buy on AliExpress'}
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
```

---

## 4. Full Popup Example

```html
<!-- popup.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { width: 380px; font-family: system-ui, sans-serif; margin: 0; padding: 12px; }
    input { width: 100%; padding: 10px; font-size: 14px; box-sizing: border-box; }
    button { width: 100%; padding: 10px; margin-top: 8px; cursor: pointer; }
    #results { margin-top: 12px; max-height: 400px; overflow-y: auto; }
    .product-card { display: flex; gap: 10px; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
    .product-card img { width: 80px; height: 80px; object-fit: cover; border-radius: 4px; }
    .product-card h3 { font-size: 13px; margin: 0 0 4px; }
    .sale-price { color: #d9534f; font-weight: bold; font-size: 15px; }
    .original-price { text-decoration: line-through; color: #999; margin-right: 6px; }
    .discount { color: #5cb85c; font-size: 12px; }
    .meta { font-size: 12px; color: #666; margin: 4px 0; }
    a { display: inline-block; background: #d9534f; color: white; text-decoration: none;
        padding: 6px 12px; border-radius: 4px; font-size: 13px; margin-top: 4px; }
  </style>
</head>
<body>
  <input type="text" id="query" placeholder="Search AliExpress...">
  <button id="btn">Search</button>
  <div id="results"></div>
  <script src="popup.js"></script>
</body>
</html>
```

```js
// popup.js
const SERVER_URL = 'https://alismart-api-v2.vercel.app';

document.getElementById('btn').addEventListener('click', async () => {
  const query = document.getElementById('query').value.trim();
  if (!query) return;

  const resultsDiv = document.getElementById('results');
  resultsDiv.textContent = 'Loading...';

  try {
    const data = await searchAliExpress(query, 20);
    if (data.success) {
      renderProducts(data, resultsDiv);
    } else {
      resultsDiv.textContent = 'Error: ' + (data.error || 'Unknown');
    }
  } catch (err) {
    resultsDiv.textContent = 'Network error: ' + err.message;
  }
});

// (include getUserLocale, searchAliExpress, renderProducts, escapeHtml from above)
```

---

## 5. manifest.json (Store-Compliant Permissions)

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

**Why this is store-safe:**
- Extension never calls AliExpress directly (all API traffic goes through your server).
- No API secrets in extension code.
- Minimal permissions (`activeTab` only — no `host` permission for aliexpress.com).

---

## 6. Supported Language → Currency / Country Map

| Language | Currency | Ship-To | UI Direction |
|----------|----------|---------|--------------|
| `he` (Hebrew) | `ILS` | `IL` | RTL |
| `en` (English) | `USD` | `US` | LTR |
| `es` (Spanish) | `EUR` | `ES` | LTR |
| `fr` (French) | `EUR` | `FR` | LTR |
| `de` (German) | `EUR` | `DE` | LTR |
| `it` (Italian) | `EUR` | `IT` | LTR |
| `pt` (Portuguese) | `BRL` | `BR` | LTR |
| `ru` (Russian) | `RUB` | `RU` | LTR |
| `ja` (Japanese) | `JPY` | `JP` | LTR |
| `ko` (Korean) | `KRW` | `KR` | LTR |
| `ar` (Arabic) | `SAR` | `SA` | RTL |
| `tr` (Turkish) | `TRY` | `TR` | LTR |
| `nl` (Dutch) | `EUR` | `NL` | LTR |
| `pl` (Polish) | `PLN` | `PL` | LTR |

Add more rows as you expand to new markets.
