# API Contract - Cart Optimizer

This server acts as the **Truth Provider** for the AliSmart Finder Extension.

## API Endpoints Summary

| Endpoint | Purpose | Cache |
|----------|---------|-------|
| `POST /api/optimizer/bundles` | Find stores with 2+ cart items (bundle shipping) | 5 min |
| `POST /api/optimizer/batch-lookup` | Fetch product details with weight/category for Tax Engine | 5 min |
| `GET /api/search` | Search AliExpress products (exact/visual modes) | 60 min |

---

## Endpoint: POST /api/optimizer/bundles

Discovers bundle opportunities - stores that carry multiple items from your cart for combined shipping savings.

### Request Schema:
```json
{
  "productIds": ["100500111", "100500222", "100500333"],
  "minMatchCount": 2,
  "prioritizeChoice": true
}
```

### Response Schema:
```json
{
  "success": true,
  "bundles": [
    {
      "storeId": "1234567",
      "storeName": "Super Electronics Store",
      "storeUrl": "https://www.aliexpress.com/store/1234567",
      "matchCount": 3,
      "isChoiceStore": true,
      "avgRating": 4.6,
      "products": [
        {
          "originalId": "100500111",
          "alternativeId": "100500444",
          "title": "Wireless Bluetooth Headphones...",
          "price": "12.99",
          "image": "https://ae01.alicdn.com/kf/..."
        }
      ]
    }
  ],
  "count": 2,
  "cartSize": 3,
  "potentialSavings": {
    "singleStoreOptions": 2,
    "bestMatchStore": "Super Electronics Store",
    "maxItemsFromSingleStore": 3
  },
  "executionTimeMs": 1245
}
```

### Parameters:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `productIds` | string[] | required | Cart product IDs to analyze |
| `minMatchCount` | number | 2 | Minimum products a store must carry |
| `prioritizeChoice` | boolean | true | Sort Choice stores higher |

### Response Fields:
| Field | Description |
|-------|-------------|
| `bundles` | Array of stores with 2+ matching items |
| `matchCount` | How many cart items this store carries |
| `isChoiceStore` | Majority of items are AliExpress Choice |
| `potentialSavings` | Summary of bundle optimization potential |

---

## Endpoint: POST /api/optimizer/batch-lookup

### Request Schema:
```json
{
  "productIds": ["100500123", "100500456"],
  "targetCurrency": "USD",
  "destinationCountry": "US",
  "findBundleOpportunities": true
}
```

### Request Parameters:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `productIds` | string[] | required | Cart product IDs to lookup |
| `targetCurrency` | string | "USD" | Target currency for price display |
| `destinationCountry` | string | "" | Destination country for shipping estimates |
| `findBundleOpportunities` | boolean | true | Enable bundle analysis (same-seller detection) |

### Response Schema (Minified for bandwidth):
```json
{
  "ok": true,
  "data": [
    {
      "w": 0.45,
      "cid": "200000123",
      "p": "12.99",
      "t": "Product Title",
      "st": "Store Name",
      "i": "https://...",
      "a": "https://s.click.aliexpress.com/e/...",
      "bid": "BND-1234567-3-a8f2"
    }
  ],
  "n": 2,
  "bundles": [
    {
      "bid": "BND-1234567-3-a8f2",
      "sid": "1234567",
      "sn": "Super Store",
      "ic": true,
      "iss": true,
      "es": 40,
      "pids": ["100500111", "100500222", "100500333"],
      "prods": [
        {
          "oid": "100500111",
          "aid": "100500444",
          "t": "Product Title",
          "p": "12.99",
          "img": "https://..."
        }
      ]
    }
  ],
  "bc": 1,
  "pbs": {
    "1234567": {
      "sid": "1234567",
      "st": "https://www.aliexpress.com/store/1234567",
      "prods": ["100500111", "100500222"]
    }
  },
  "et": 245,
  "cache": false,
  "ba": {
    "tb": 1,
    "cba": true,
    "bb": {
      "bid": "BND-1234567-3-a8f2",
      "sid": "1234567",
      "sn": "Super Store",
      "pc": 3,
      "ic": true,
      "iss": true,
      "es": 40
    }
  }
}
```

### Field Mapping (Minified Keys):
| Key | Full Name | Type | Description |
|-----|-----------|------|-------------|
| `w` | packageWeight | Float/Null | Weight in KG |
| `cid` | categoryId | String | AliExpress category ID |
| `p` | price | String | Product price (preserves currency) |
| `t` | title | String | Product title (max 200 chars) |
| `st` | storeUrl | String | Seller store URL |
| `i` | imgUrl | String | Product image URL (HTTPS) |
| `a` | affiliateLink | String | Affiliate promotion link |
| `id` | productId | String | AliExpress product ID |
| `sc` | shippingCost | Float | Shipping cost value |
| `r` | rating | Float/Null | Product rating (0-5) |
| `s` | totalSales | Number | Total sales volume |
| `d` | discountPct | Float | Discount percentage |
| `bid` | bundleId | String/Null | Bundle ID if item belongs to same-seller bundle |
| `bundles` | bundles | Array | Array of bundle opportunities (each with bid, sid, sn, pids) |
| `bc` | bundleCount | Number | Total number of bundles found |
| `pbs` | productsByStore | Object | Products grouped by storeId |
| `ba` | bundleAnalysis | Object | Bundle analysis summary |
| `tb` | totalBundles | Number | Total bundle opportunities found |
| `cba` | canBundleAll | Boolean | Whether all items can be bought from one store |
| `bb` | bestBundle | Object | Best bundle option (highest score) |
| `pc` | productCount | Number | Items in this bundle |
| `ic` | isChoiceStore | Boolean | Store is AliExpress Choice |
| `iss` | isSuperSeller | Boolean | Store has super-seller indicators |
| `es` | estimatedSavings | Number | Estimated shipping savings % |

### Response Envelope Fields:
| Key | Full Name | Description |
|-----|-----------|-------------|
| `ok` | success | Boolean success status |
| `data` | products | Array of product objects |
| `n` | count | Number of products returned |
| `bundles` | bundles | Array of bundle opportunities (see Bundle Object below) |
| `bc` | bundleCount | Number of bundles found |
| `pbs` | productsByStore | Products grouped by storeId for client processing |
| `ba` | bundleAnalysis | Bundle optimization analysis summary |
| `et` | executionTimeMs | Server processing time |
| `cache` | cached | Whether response was cached |
| `err` | error | Error message (if any) |

### Bundle Object Structure (in `bundles` array):
```json
{
  "bundleId": "BND-1234567-3-a8f2",
  "storeId": "1234567",
  "storeName": "Super Electronics Store",
  "storeUrl": "https://www.aliexpress.com/store/1234567",
  "isChoiceStore": true,
  "isSuperSeller": true,
  "estimatedSavings": 40,
  "productIds": ["100500111", "100500222", "100500333"],
  "products": [
    {
      "originalId": "100500111",
      "alternativeId": "100500444",
      "title": "Product Title",
      "price": "12.99",
      "image": "https://ae01.alicdn.com/kf/..."
    }
  ]
}
```

## Rules:

1. **Content Safety**: All products must pass through `content-filter.js` (The Shield) before being returned.
2. **Missing Fields**: If a field is missing from AliExpress API, return:
   - `null` for optional fields (w, r)
   - `0` for numeric fields without value (sc, s, d)
   - `""` for string fields without value (cid, st)
3. **Cache Duration**:
   - `batch-lookup`: 5 minutes (cart data changes frequently)
   - `bundles`: 5 minutes (bundle opportunities change with inventory)
4. **Max Batch Size**: 20 product IDs per request for all optimizer endpoints.
5. **CORS**: Enabled for extension origins (`*` for development).

## Service Function: `findAlternativeSellers(productIds, contentFilter)`

### Purpose:
Find "Super-Sellers" or "AliExpress Choice" stores that carry multiple items from a cart (bundle optimization).

### Input:
| Parameter | Type | Description |
|-----------|------|-------------|
| `productIds` | string[] | Array of cart product IDs to analyze |
| `contentFilter` | Function | Optional: The Shield filter function |

### Output (Bundle Array):
```javascript
[
  {
    storeId: "1234567",
    storeUrl: "https://www.aliexpress.com/store/1234567",
    storeName: "Super Electronics Store",
    matchCount: 3,           // Number of cart items this store carries
    isChoiceStore: true,     // Majority of items are AliExpress Choice
    avgRating: 4.6,
    products: [
      {
        originalProductId: "100500111",
        alternativeProductId: "100500222",
        alternativeTitle: "...",
        alternativePrice: "12.99",
        alternativeImage: "https://..."
      }
    ]
  }
]
```

### Algorithm:
1. For each cart item, fetch alternative products using `searchByProductId()`
2. Map stores to products they carry (using `storeUrl` extraction)
3. Filter to stores with 2+ matching cart items
4. Apply content filter (The Shield) to each alternative
5. Sort by: matchCount (desc) → isChoiceStore → avgRating (desc)

### Performance:
- Parallel processing of all product IDs
- Typical cart (5-15 items): ~500-1500ms
- Returns only bundles with 2+ items (single-item stores filtered out)

## AI Instruction:

> **From now on, any changes to `services/aliexpress.js`, `services/json-minify.js`, or `services/bundle-finder.js` must adhere to this CONTRACT.md. Do not change the keys `w`, `cid`, or `bid` as the Extension relies on them for the Tax Engine and Bundle Optimizer.**

### Critical Keys (Never Change):
- `w` → packageWeight (Tax Engine)
- `cid` → categoryId (Tax Engine)  
- `bid` → bundleId (Bundle Optimizer)
- `ba` → bundleAnalysis (Bundle summary)

If you need to add new fields, update this contract first and ensure backward compatibility.

## Service Files Overview

| File | Purpose | Contract Keys |
|------|---------|---------------|
| `services/aliexpress.js` | AliExpress API integration | All product data fields |
| `services/bundle-finder.js` | Bundle discovery logic | `bid`, bundle analysis |
| `services/json-minify.js` | Key minification | `w`, `cid`, `bid`, `ba`, etc. |
| `services/content-filter.js` | The Shield (safety) | N/A (internal) |
| `services/cache.js` | In-memory caching | N/A (internal) |
