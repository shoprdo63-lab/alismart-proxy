/**
 * Translation Endpoint - Lightweight Server
 * POST /api/translate
 * 
 * Body:
 * - text: string (text to translate)
 * - targetLanguage: string (default: 'en')
 * 
 * Returns translated text or original if no translation service configured
 */

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const EXTENSION_ID = process.env.EXTENSION_ID || '';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || 
    (EXTENSION_ID && origin === `chrome-extension://${EXTENSION_ID}`) ||
    ALLOWED_ORIGINS.includes('*') ||
    origin.startsWith('chrome-extension://');
  
  if (req.method === 'OPTIONS') {
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  const { text, targetLanguage = 'en' } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid text parameter'
    });
  }

  try {
    // Simple translation - if no API key, return original with indication
    // You can integrate Google Translate, DeepL, or other service here
    const translatedText = await translateText(text, targetLanguage);
    
    return res.status(200).json({
      success: true,
      originalText: text,
      translatedText: translatedText,
      targetLanguage,
      isTranslated: translatedText !== text
    });
  } catch (error) {
    console.error('[Translate] Error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Translation failed',
      message: error.message
    });
  }
}

/**
 * Simple translation function
 * For now, returns text as-is. Add your translation API here.
 */
async function translateText(text, targetLanguage) {
  // Placeholder: return original text
  // To integrate a real translation service, add API key to env vars
  // and implement the API call here
  
  // Example integration:
  // if (process.env.GOOGLE_TRANSLATE_API_KEY) {
  //   return await googleTranslate(text, targetLanguage);
  // }
  
  console.log(`[Translate] ${text.substring(0, 50)}... -> ${targetLanguage} (placeholder)`);
  return text; // Return as-is for now
}
