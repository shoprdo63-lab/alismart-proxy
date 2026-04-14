# API Contract - Cart Optimizer

This server acts as the **Truth Provider** for the AliSmart Finder Extension.

## Endpoint: POST /api/optimizer/batch-lookup

### Request Schema:
```json
{
  "productIds": ["100500123", "100500456"],
  "targetCurrency": "USD",
  "destinationCountry": "US"
}
```

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
      "a": "https://s.click.aliexpress.com/..."
    }
  ],
  "n": 2,
  "et": 245,
  "cache": false
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

### Response Envelope Fields:
| Key | Full Name | Description |
|-----|-----------|-------------|
| `ok` | success | Boolean success status |
| `data` | products | Array of product objects |
| `n` | count | Number of products returned |
| `et` | executionTimeMs | Server processing time |
| `cache` | cached | Whether response was cached |
| `err` | error | Error message (if any) |

## Rules:

1. **Content Safety**: All products must pass through `content-filter.js` (The Shield) before being returned.
2. **Missing Fields**: If a field is missing from AliExpress API, return:
   - `null` for optional fields (w, r)
   - `0` for numeric fields without value (sc, s, d)
   - `""` for string fields without value (cid, st)
3. **Cache Duration**: 5 minutes for batch-lookup (cart data changes frequently).
4. **Max Batch Size**: 20 product IDs per request.
5. **CORS**: Enabled for extension origins (`*` for development).

## AI Instruction:

> **From now on, any changes to `services/aliexpress.js` or `services/json-minify.js` must adhere to this CONTRACT.md. Do not change the keys `w` or `cid` as the Extension relies on them for the Tax Engine.**

If you need to add new fields, update this contract first and ensure backward compatibility.
