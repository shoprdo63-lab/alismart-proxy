// api/gateway-search.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { keywords, language = 'en', currency = 'USD' } = req.body;

  try {
    // בניית URL חיפוש גלובלי של אליאקספרס
    const searchUrl = `https://www.aliexpress.com/w/wholesale-main.html?SearchText=${encodeURIComponent(keywords)}&SortType=SALE_PRICE_ASC&g=y`;

    // כאן בעתיד תוכל להוסיף לוגיקה של שליפת נתונים (Scraping)
    return res.status(200).json({ 
      success: true, 
      products: [], // כרגע מחזיר ריק כדי למנוע קריסות, רק מוודא שהחיבור עובד
      url: searchUrl 
    });
  } catch (error) {
    return res.status(500).json({ error: 'Proxy server error' });
  }
}
