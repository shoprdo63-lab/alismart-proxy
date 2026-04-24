# Backend Guidelines - API Gateway Architecture

## Overview
The server acts as a **Smart Data Pipeline (API Gateway)** between the browser extension and AliExpress.
**Role Change**: From "Data Scraper" → "Smart API Gateway"

---

## Core Principles

### 1. NO Image Proxy/Scraping (Critical)
```
STATUS: ✅ IMPLEMENTED
```
- **Server NEVER loads or fetches images**
- **Server NEVER follows affiliate link redirects**
- All image handling is delegated to the **client (browser)**
- This prevents AliExpress from detecting the server IP as a bot

**Implementation:**
- `maxRedirects: 0` in all axios requests
- Image URLs are passed-through or normalized only
- CDN URLs generated for client-side use: `https://ae01.alicdn.com/kf/{productId}.jpg`

---

### 2. API Response Normalization
```
STATUS: ✅ IMPLEMENTED
```
The server returns clean JSON with standardized fields:

```javascript
{
  productId: string,        // Always present
  title: string,            // Max 200 chars
  price: string,             // Formatted price
  originalPrice: string,     // Original price (if on sale)
  originalUrl: string,       // Direct product URL
  imgUrl: string,           // Cleaned image URL (no tracking)
  cdnImageUrl: string,      // Direct CDN for client
  affiliateLink: string,    // Promotion/affiliate URL
  rating: number|null,     // Product rating
  totalSales: number,       // Sales volume
  storeUrl: string,        // Store link
  storeName: string,        // Store name
  isChoiceItem: boolean,   // Choice product flag
  discountPct: number,     // Discount percentage
  // ... visual search specific fields
}
```

---

### 3. Dynamic Localization
```
STATUS: ✅ IMPLEMENTED
```
Server accepts localization parameters from extension and forwards to AliExpress API:

**Request Parameters:**
| Parameter | Description | Example |
|-----------|-------------|---------|
| `locale` | Language code | `en`, `es`, `he`, `fr` |
| `currency` | Currency code | `USD`, `ILS`, `EUR` |
| `region` | Ship-to country | `US`, `IL`, `ES` |

**Implementation:**
- Headers built with `Accept-Language`, currency cookies, region cookies
- Fallback to `en_US/USD` if blocked (403/429)
- All parameters flow: Extension → API → AliExpress API

---

### 4. Caching (Rate Limiting Protection)
```
STATUS: ✅ IMPLEMENTED (10 minutes TTL)
```

**Purpose:** Prevent API flooding and reduce AliExpress API calls

**Cache Configuration:**
```javascript
// Cache TTL: 600 seconds (10 minutes)
cache.set(cacheKey, response, 600);
```

**Cache Key Pattern:**
```
visual:{imageUrl}:{limit}:{expandSearch}:{locale}:{currency}:{region}:{timestamp}
```

**Cache-Busting:**
- `_t` query parameter forces fresh results
- `skipCache=true` bypasses cache

---

### 5. Human-Like Headers (User-Agent Passthrough)
```
STATUS: ✅ IMPLEMENTED
```

**Rule:** Server passes client's User-Agent to AliExpress API requests

**Flow:**
```
Browser (User-Agent) 
  → Extension Request 
  → API (req.headers['user-agent']) 
  → AliExpress API Request (User-Agent header)
```

**Implementation Chain:**
1. `api/visual-search.js` extracts `clientUserAgent` from request
2. Passes to `visualSearchEnhanced({ userAgent })`
3. Passes to `getIdsByImage({ userAgent })`
4. `buildAliExpressHeaders()` uses custom User-Agent if provided

**Fallback:** If no User-Agent provided, uses browser-like default

---

## Data Flow Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Extension     │────▶│   API Gateway    │────▶│  AliExpress     │
│   (Browser)     │     │   (This Server)  │     │   API           │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │                         │
        │ 1. Sends imageUrl      │                         │
        │    + locale            │                         │
        │    + currency          │                         │
        │    + User-Agent        │                         │
        │───────────────────────▶│                         │
        │                        │ 2. Check cache          │
        │                        │    (10 min TTL)         │
        │                        │                         │
        │                        │ 3. If miss:             │
        │                        │    Call AliExpress      │
        │                        │    with human headers   │
        │                        │    + User-Agent         │
        │                        │────────────────────────▶│
        │                        │                         │
        │                        │ 4. Normalize response     │
        │                        │    (clean fields)       │
        │                        │                         │
        │ 5. Return JSON         │                         │
        │    + CDN URLs          │                         │
        │◀───────────────────────│                         │
        │                        │                         │
        │ 6. Client loads images │                         │
        │    directly from CDN   │                         │
        │    (ae01.alicdn.com)   │                         │
        └────────────────────────┘                         │
```

---

## File Responsibilities

### `api/visual-search.js`
- **Entry point** for visual search requests
- Extracts `User-Agent` from client headers
- Manages caching (10 min TTL)
- Normalizes product response fields
- Generates CDN image URLs
- Returns clean JSON to extension

### `services/aliexpress.js`
- **Low-level AliExpress API client**
- `getIdsByImage()` - Visual search by image URL
- `getProductDetails()` - Fetch product details by IDs
- `searchByKeywords()` - Keyword search
- **NO redirects** (`maxRedirects: 0`)
- **Human headers** with User-Agent passthrough
- **Global fallback** (en_US/USD) on 403/429

### `services/visual-search-enhanced.js`
- **High-level search orchestration**
- Coordinates visual + keyword + hot products
- Accepts `userAgent` parameter
- Clusters similar products
- Returns enriched results

### `services/cache.js`
- Simple in-memory cache
- TTL-based expiration
- Used for rate limiting protection

---

## Security & Anti-Detection Rules

### ✅ DO
- Pass through client's User-Agent
- Set `maxRedirects: 0` on all requests
- Use client's locale/currency/region
- Cache results to minimize API calls
- Return CDN URLs for client-side image loading

### ❌ DON'T
- Follow affiliate link redirects
- Fetch or proxy images through server
- Use server IP for browsing AliExpress
- Send requests without proper headers
- Cache for too long (max 10 minutes)

---

## Environment Variables

```bash
# AliExpress API Credentials
ALI_APP_KEY=your_app_key
ALI_APP_SECRET=your_app_secret
ALI_TRACKING_ID=your_tracking_id

# Optional: Extension Origin Validation
ALLOWED_EXTENSION_ORIGINS=https://your-extension.com
EXTENSION_ID=your_extension_id
```

---

## Response Examples

### Success Response
```json
{
  "success": true,
  "products": [
    {
      "productId": "3256801234567890",
      "title": "Wireless Bluetooth Headphones",
      "price": "12.99",
      "originalPrice": "25.99",
      "originalUrl": "https://www.aliexpress.com/item/3256801234567890.html",
      "imgUrl": "https://ae01.alicdn.com/kf/Sxxx.jpg",
      "cdnImageUrl": "https://ae01.alicdn.com/kf/3256801234567890.jpg",
      "affiliateLink": "https://s.click.aliexpress.com/...",
      "rating": 4.8,
      "totalSales": 1250,
      "storeUrl": "https://www.aliexpress.com/store/123456",
      "storeName": "Tech Store",
      "isChoiceItem": true,
      "discountPct": 50
    }
  ],
  "count": 1,
  "locale": "en",
  "currency": "USD",
  "cached": false
}
```

### Error Response (Captcha/Block)
```json
{
  "success": false,
  "error": "Visual search failed",
  "message": "AliExpress returned captcha/challenge page",
  "products": [],
  "status": "requires_manual_search"
}
```

---

## Testing Checklist

- [ ] Visual search returns clean JSON
- [ ] No image URLs contain `s.click` redirects (stripped)
- [ ] `cdnImageUrl` is generated for each product
- [ ] Cache works (10 min TTL)
- [ ] User-Agent from browser appears in API requests
- [ ] Locale/currency passed through correctly
- [ ] Fallback to en_US/USD on 403 works
- [ ] No server-side redirects followed

---

## Summary

| Feature | Status | Location |
|---------|--------|----------|
| No Image Proxy | ✅ | `aliexpress.js:maxRedirects=0` |
| API Normalization | ✅ | `visual-search.js:normalizeImageUrl()` |
| Localization | ✅ | `aliexpress.js:buildAliExpressHeaders()` |
| Caching (10min) | ✅ | `visual-search.js:cache.set(..., 600)` |
| User-Agent Passthrough | ✅ | Full chain from API → aliexpress.js |
| CDN URL Generation | ✅ | `generateCdnImageUrl()` |
| Tracking URL Stripping | ✅ | `normalizeImageUrl()` filters s.click |
