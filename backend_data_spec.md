# Backend Data Specification — AliSmart Proxy v2

## Overview

This document defines the optimal data structure for returning **100+ enriched products** per search request, along with real-time niche analytics. The architecture is designed for the AliExpress Affiliate API (`aliexpress.affiliate.product.query`) with batch pagination, in-memory caching, and content-safety filtering.

---

## 1. Data Sources & Enrichment Strategy

### Primary Source: AliExpress Affiliate API
- **Endpoint**: `aliexpress.affiliate.product.query`
- **Page size**: 20 products/page (API max)
- **Batch strategy**: Fetch pages 1–50 in chunked waves of 5 via `Promise.all` → up to 1000 products per query
- **Fields requested**: `product_id, product_title, product_main_image_url, product_detail_url, sale_price, original_price, promotion_link, evaluate_rate, lastest_volume, discount, commission_rate, shop_url`

### Derived Enrichment (Computed Server-Side)
| Field | Source | Calculation |
|---|---|---|
| `trust_score` | `evaluate_rate` + `lastest_volume` + price stability | Weighted composite (see §3) |
| `discount_pct` | `original_price`, `sale_price` | `(1 - sale/original) * 100` |
| `price_numeric` | `sale_price` | Parsed float, currency-stripped |
| `market_position` | All results in batch | Percentile rank by volume × rating |
| `relevance_score` | query nouns vs title | `(matched_nouns / total_query_nouns) × 100` |

---

## 2. Product Schema (Single Item)

```json
{
  "productId": "1005007123456789",
  "title": "Wireless Bluetooth Headphones Noise Cancelling",
  "price": "12.99",
  "originalPrice": "29.99",
  "priceNumeric": 12.99,
  "currency": "USD",
  "discountPct": 56.7,
  "imgUrl": "https://ae01.alicdn.com/kf/...",
  "productUrl": "https://s.click.aliexpress.com/e/...",
  "affiliateLink": "https://s.click.aliexpress.com/e/...",
  "rating": 4.7,
  "totalSales": 1523,
  "trustScore": 82.4,
  "storeUrl": "https://www.aliexpress.com/store/...",
  "commissionRate": "5.0%",
  "category": "electronics",
  "shippingSpeed": "standard",
  "relevanceScore": 75.0,
  "marketPosition": "top_20pct"
}
```

### Field Details

| Field | Type | Description |
|---|---|---|
| `productId` | string | AliExpress unique product ID |
| `title` | string | Product title, truncated to 200 chars |
| `price` | string | Sale price as string (preserves currency symbol) |
| `originalPrice` | string | Original price before discount |
| `priceNumeric` | number | Parsed sale price as float for calculations |
| `currency` | string | Detected currency code (USD default) |
| `discountPct` | number | Discount percentage (0–100), 0 if no discount |
| `imgUrl` | string | HTTPS-normalized main product image URL |
| `productUrl` | string | Affiliate link with tracking ID |
| `affiliateLink` | string | Direct affiliate promotion link |
| `rating` | number\|null | Product rating (0–5 scale), null if unavailable |
| `totalSales` | number | Recent sales volume (`lastest_volume`) |
| `trustScore` | number | Composite trust metric (0–100), see §3 |
| `storeUrl` | string | Seller store URL |
| `commissionRate` | string | Affiliate commission rate |
| `category` | string\|null | Detected product category |
| `shippingSpeed` | string | "fast" (≤10d), "standard" (11–20d), "slow" (>20d) |
| `relevanceScore` | number | Semantic noun-overlap score (0–100), items <25 are filtered out |
| `marketPosition` | string | "top_10pct", "top_20pct", "mid", "low" |

---

## 3. Trust Score Algorithm

The **Trust Score** is a weighted composite (0–100) designed to approximate product reliability without requiring external review APIs.

```
trust_score = (W_rating × rating_norm) + (W_sales × sales_norm) + (W_price × price_norm)

Where:
  W_rating = 0.45   (product rating weight)
  W_sales  = 0.35   (sales volume weight)
  W_price  = 0.20   (price reasonableness weight)

  rating_norm = (rating / 5.0) × 100
  sales_norm  = min(totalSales / max_sales_in_batch × 100, 100)
  price_norm  = 100 - |price_deviation_from_median| / median × 100 (clamped 0–100)
```

**Rationale** (derived from academic trust literature):
- **Rating** is the strongest signal but can be manipulated; weight at 0.45
- **Sales volume** indicates market validation; weight at 0.35
- **Price stability** relative to median detects both suspiciously cheap and overpriced items; weight at 0.20

---

## 4. Niche Analytics Schema (Per Search)

Returned alongside products in every response:

```json
{
  "nicheAnalytics": {
    "avgPrice": 15.42,
    "minPrice": 2.99,
    "maxPrice": 89.99,
    "medianPrice": 12.50,
    "maxDiscountProduct": {
      "productId": "1005007123456789",
      "title": "...",
      "discountPct": 78.5,
      "price": "4.99",
      "originalPrice": "23.20"
    },
    "totalNicheVolume": 45230,
    "competitionIndex": 0.34,
    "topRatedCount": 27,
    "lowRatedCount": 53,
    "totalAnalyzed": 120
  }
}
```

| Field | Type | Calculation |
|---|---|---|
| `avgPrice` | number | Mean of all `priceNumeric` values |
| `minPrice` | number | Lowest price in result set |
| `maxPrice` | number | Highest price in result set |
| `medianPrice` | number | Median of all `priceNumeric` values |
| `maxDiscountProduct` | object | Product with highest `discountPct` |
| `totalNicheVolume` | number | Sum of all `totalSales` across results |
| `competitionIndex` | number | `topRatedCount / (topRatedCount + lowRatedCount)` — ratio 0–1 |
| `topRatedCount` | number | Products with rating ≥ 4.5 |
| `lowRatedCount` | number | Products with rating < 4.0 |
| `totalAnalyzed` | number | Total products in analytics batch |

**Competition Index Interpretation**:
- `> 0.6` — High competition (many strong sellers)
- `0.3–0.6` — Moderate competition
- `< 0.3` — Low competition / opportunity niche

---

## 5. Caching Architecture

| Layer | Strategy | TTL | Key Format |
|---|---|---|---|
| **Search results** | In-memory `Map` | 60 min | `search:{mode}:{query_hash}` |
| **Analytics** | Computed per-request, cached with results | 60 min | Bundled with search cache |
| **Eviction** | Periodic sweep every 10 min | — | Removes entries older than TTL |

- **Redis-ready**: Cache interface is abstracted. Swap in Redis by implementing `get(key)`, `set(key, value, ttlMs)`, `del(key)` methods.
- **Max cache entries**: 500 (prevents memory overflow on serverless)

---

## 6. Batch Fetching Architecture

```
Client Request
      │
      ▼
  ┌─────────────┐
  │ Cache Check  │──hit──▶ Return cached response
  └──────┬──────┘
         │ miss
         ▼
  ┌──────────────────────┐
  ┌──────────────────────┐
  │ Chunk 1: pages 1-5  │── Promise.all(5 concurrent)
  │ Chunk 2: pages 6-10 │── Promise.all(5 concurrent)
  │ ...                  │
  │ Chunk 10: pages 46-50│── Promise.all(5 concurrent)
  │                      │  ◄── 50 pages × 20 = 1000 max
  │ (early-exit if 2     │      (deduped to ~1000)
  │  empty chunks)       │
  └──────────┬───────────┘
             │
             ▼
  ┌────────────────────┐
  │ Content Filter     │ ◄── Halachic safety / tzniut check
  │ (block inappropriate│
  │  content)          │
  └──────────┬─────────┘
             │
             ▼
  ┌────────────────────┐
  │ Relevance Filter   │ ◄── Semantic noun-matching (threshold ≥25)
  │ (drop irrelevant   │
  │  products)         │
  └──────────┬─────────┘
             │
             ▼
  ┌────────────────────┐
  │ Enrich + Analytics │ ◄── Trust score, discount %, niche stats
  └──────────┬─────────┘
             │
             ▼
  ┌────────────────────┐
  │ Cache Store        │ ◄── Store for 60 min
  └──────────┬─────────┘
             │
             ▼
      Return Response
```

---

## 7. Response Envelope

```json
{
  "success": true,
  "products": [ /* enriched product objects */ ],
  "data": [ /* same as products (backward compat) */ ],
  "count": 987,
  "mode": "exact",
  "category": "electronics",
  "nicheAnalytics": { /* see §4 */ },
  "executionTimeMs": 1842,
  "cached": false,
  "pagesScanned": 50
}
```

---

## 8. Performance Targets

| Metric | Target | Method |
|---|---|---|
| Products per search | ~1000 | 50 pages in 10 chunks of 5 |
| Response time (cold) | < 5000 ms | Chunked `Promise.all` parallelism |
| Response time (cached) | < 50 ms | In-memory cache hit |
| Cache hit rate | > 40% | 1-hour TTL on common queries |
| Memory footprint | < 50 MB | 500-entry cache cap with eviction |

---

## 9. Content Safety (Halachic Compliance)

All product titles and categories pass through a keyword-based content filter before being returned. Products matching blocked patterns are silently removed from results. The filter covers:
- Inappropriate clothing descriptors (immodest/revealing)
- Adult content keywords
- Idolatry / avodah zarah related items
- Mixed-fiber (shatnez) risk indicators for clothing

The filter operates as a **blocklist** — items are removed only on match, preserving all safe results.
