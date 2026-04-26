# 🚀 הוראות מלאות להגדרת שרת Vercel עבור AliSmart

## 📋 סיכום
התוסף משתמש בשרת Vercel כ-Proxy לחיפוש מוצרים ב-AliExpress. יש לעדכן את השרת להשתמש ב-API החדש `aliexpress.ds.product.search` במקום `aliexpress.affiliate.product.query`.

---

## 🎯 שינויים נדרשים בשרת

### 1. עדכון קובץ החיפוש הראשי (`api/search.js`)

החלף את הקוד הקיים בקוד הבא:

```javascript
// api/search.js
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    q, 
    page = 1, 
    pageSize = 50, 
    sort = 'RELEVANCE',
    locale = 'en_US',
    currency = 'USD',
    shipToCountry = 'US'
  } = req.body;

  if (!q || q.trim() === '') {
    return res.status(400).json({ 
      error: 'Missing search query',
      success: false 
    });
  }

  try {
    console.log('[Server] Searching for:', q);

    // קריאה ל-AliExpress Dropshipping API
    const apiUrl = 'https://api.aliexpress.com/v1/aliexpress.ds.product.search';
    
    const requestBody = {
      // פרמטרים חובה
      q: q.trim(),
      
      // פרמטרים אופציונליים
      page: parseInt(page),
      pageSize: Math.min(parseInt(pageSize), 50), // מקסימום 50
      
      // מיון - אפשרויות: RELEVANCE, SALE_PRICE_ASC, SALE_PRICE_DESC, LAST_VOLUME_DESC
      sort: sort,
      
      // הגדרות אזוריות
      locale: locale,
      currency: currency,
      shipTo: shipToCountry,
      
      // פילטרים נוספים (אופציונלי)
      minPrice: req.body.minPrice || undefined,
      maxPrice: req.body.maxPrice || undefined,
      
      // קטגוריה (אופציונלי)
      categoryId: req.body.categoryId || undefined
    };

    // הסרת undefined values
    Object.keys(requestBody).forEach(key => {
      if (requestBody[key] === undefined) {
        delete requestBody[key];
      }
    });

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.ALIEXPRESS_TOKEN}`,
        'X-Api-Key': process.env.ALIEXPRESS_APP_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Server] AliExpress API error:', response.status, errorText);
      throw new Error(`AliExpress API error: ${response.status}`);
    }

    const data = await response.json();
    
    // עיבוד התוצאות
    const products = data.data?.products || [];
    const totalCount = data.data?.totalCount || 0;
    
    console.log(`[Server] Found ${products.length} products out of ${totalCount}`);

    // החזרת תוצאות בפורמט שהתוסף מצפה לו
    res.status(200).json({
      success: true,
      products: products.map(p => ({
        productId: p.productId,
        title: p.subject || p.title,
        price: {
          current: p.salePrice?.amount || p.price,
          original: p.originalPrice?.amount || p.price,
          currency: p.salePrice?.currency || currency
        },
        image: p.productMainImage || p.imageUrl,
        rating: p.evaluationRating || 0,
        orders: p.orders || 0,
        store: {
          name: p.storeName || 'AliExpress Store',
          id: p.storeId
        },
        shipping: {
          free: p.shippingFee?.freeShipping || false,
          cost: p.shippingFee?.amount || 0
        },
        url: p.productDetailUrl || `https://www.aliexpress.com/item/${p.productId}.html`
      })),
      count: products.length,
      totalCount: totalCount,
      page: page,
      pageSize: pageSize,
      query: q
    });

  } catch (error) {
    console.error('[Server] Error:', error.message);
    
    res.status(500).json({ 
      error: error.message,
      success: false,
      products: [],
      count: 0
    });
  }
}
```

---

### 2. עדכון קובץ התצורה (`vercel.json`)

וודא שהקובץ `vercel.json` מוגדר כך:

```json
{
  "version": 2,
  "functions": {
    "api/*.js": {
      "maxDuration": 30
    }
  },
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/$1"
    }
  ],
  "env": {
    "ALIEXPRESS_TOKEN": "@aliexpress-token",
    "ALIEXPRESS_APP_KEY": "@aliexpress-app-key"
  }
}
```

---

### 3. הגדרת Environment Variables ב-Vercel

בלוח הבקרה של Vercel, הוסף את המשתנים הבאים:

```
ALIEXPRESS_TOKEN=your_aliexpress_token_here
ALIEXPRESS_APP_KEY=your_aliexpress_app_key_here
```

---

### 4. התקנת חבילות נדרשות (`package.json`)

עדכן את `package.json` בשרת:

```json
{
  "name": "alismart-api",
  "version": "2.0.0",
  "description": "AliSmart Search API using AliExpress DS",
  "main": "api/search.js",
  "scripts": {
    "dev": "vercel dev",
    "deploy": "vercel --prod"
  },
  "dependencies": {},
  "devDependencies": {
    "vercel": "latest"
  }
}
```

---

## 🔧 הבדלים עיקריים בין APIs

| תכונה | `affiliate.product.query` (ישן) | `ds.product.search` (חדש) |
|-------|----------------------------------|---------------------------|
| **מטרה** | חיפוש מוצרים לשותפים | חיפוש מוצרים ל-Dropshipping |
| **איכות תוצאות** | כללית יותר | ממוקדת יותר |
| **פרמטר חיפוש** | `keywords` | `q` |
| **מספר עמוד** | `page_no` | `page` |
| **גודל עמוד** | `page_size` (max 50) | `pageSize` (max 50) |
| **מיון** | מוגבל | RELEVANCE, SALE_PRICE_ASC, etc. |
| **מחירים** | בסיסי | מפורט (salePrice, originalPrice) |

---

## ✅ בדיקת השרת

לאחר העדכון, בדוק את השרת עם:

```bash
# בדיקה מקומית
vercel dev

# שליחת בקשת בדיקה
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "q": "chess board wooden",
    "page": 1,
    "pageSize": 10,
    "sort": "RELEVANCE"
  }'
```

---

## 🚀 פריסה לייצור

```bash
# פריסה ל-Vercel
vercel --prod
```

---

## 📝 הערות חשובות

1. **API Keys**: ודא שיש לך App Key ו-Secret מ-AliExpress Open Platform
2. **Rate Limits**: AliExpress מגביל את מספר הבקשות (בדרך כלל 100/דקה)
3. **Caching**: מומלץ להוסיף cache לתוצאות חיפוש (Redis או Vercel Edge Config)
4. **Error Handling**: השרת הנוכחי כולל טיפול בשגיאות בסיסי

---

## 🔗 קישורים שימושיים

- [AliExpress Open Platform](https://open.aliexpress.com/)
- [DS Product Search API Docs](https://open.aliexpress.com/doc/api.htm?spm=a2o9m.11193535.0.0.4c6a42a5nYnq1X#/api?cid=20807&path=aliexpress.ds.product.search&methodType=GET/POST)
- [Vercel Functions Docs](https://vercel.com/docs/concepts/functions/serverless-functions)

---

**מוכן!** 🎉
אחרי עדכון השרת, התוסף אמור לקבל תוצאות חיפוש רלוונטיות יותר!
