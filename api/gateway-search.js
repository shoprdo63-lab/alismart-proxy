// api/gateway-search.js
export default async function handler(req, res) {
  // 1. הגדרת CORS (חובה כדי שתוסף הכרום יוכל לקבל תשובה)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // מומלץ בהמשך להחליף למזהה התוסף שלך
  res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,PATCH,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // טיפול בבקשת Preflight של הדפדפן
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. וידוא שהבקשה היא POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // הגנה מפני קריסה אם req.body לא קיים
  const { keywords, language = 'en', currency = 'USD' } = req.body || {};

  if (!keywords) {
    return res.status(400).json({ error: 'Keywords are required' });
  }

  try {
    // בניית URL חיפוש גלובלי של אליאקספרס
    const searchUrl = `https://www.aliexpress.com/w/wholesale-main.html?SearchText=${encodeURIComponent(keywords)}&SortType=SALE_PRICE_ASC&g=y`;

    // החזרת תשובה תקינה
    return res.status(200).json({ 
      success: true, 
      products: [], 
      url: searchUrl 
    });
  } catch (error) {
    return res.status(500).json({ error: 'Proxy server error' });
  }
}