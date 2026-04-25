/**
 * Translation Endpoint - Lightweight Server
 * POST /api/translate
 * 
 * Body:
 * - text: string (text to translate)
 * - targetLanguage: string (default: 'en')
 * 
 * Uses Google Translate via @vitalets/google-translate-api (free, no API key needed)
 */

import { translate } from '@vitalets/google-translate-api';

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
    console.log(`[Translate] Translating: "${text.substring(0, 50)}..." -> ${targetLanguage}`);
    
    const result = await translate(text, { to: targetLanguage });
    
    console.log(`[Translate] Success: "${result.text.substring(0, 50)}..."`);
    
    return res.status(200).json({
      success: true,
      originalText: text,
      translatedText: result.text,
      detectedSourceLanguage: result.from.language.iso,
      targetLanguage,
      isTranslated: result.text !== text
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
