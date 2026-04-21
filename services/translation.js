/**
 * Multi-language Translation Service
 * Translates search queries from any language to English for optimal AliExpress API results
 * Supports all languages via Google Translate API (unofficial endpoint)
 */

const axios = require('axios');
const cache = require('./cache.js');

// Simple dictionary for common Hebrew to English translations (fallback)
const HEBREW_TO_ENGLISH_DICT = {
  // Clothing
  'חולצה': 'shirt',
  'מכנסיים': 'pants',
  'שמלה': 'dress',
  'חצאית': 'skirt',
  'ג׳ינס': 'jeans',
  'ג׳קט': 'jacket',
  'מעיל': 'coat',
  'סווטשרט': 'sweater',
  'הודי': 'hoodie',
  'בלוזה': 'blouse',
  'חולצת טריקו': 't-shirt',
  'תחתונים': 'underwear',
  'גרביים': 'socks',
  'נעליים': 'shoes',
  'סנדלים': 'sandals',
  'מגפיים': 'boots',
  
  // Electronics
  'טלפון': 'phone',
  'סמארטפון': 'smartphone',
  'מחשב נייד': 'laptop',
  'מחשב': 'computer',
  'אוזניות': 'headphones',
  'אוזנייה': 'earphone',
  'שמע': 'audio',
  'מטען': 'charger',
  'כבל': 'cable',
  'סוללה': 'battery',
  'מארז': 'case',
  'מגן': 'protector',
  'מסך': 'screen',
  
  // Home & Kitchen
  'ריהוט': 'furniture',
  'שולחן': 'table',
  'כיסא': 'chair',
  'ספה': 'sofa',
  'מיטה': 'bed',
  'מזרן': 'mattress',
  'מטבח': 'kitchen',
  'סיר': 'pot',
  'מחבת': 'pan',
  'סכין': 'knife',
  'צלחת': 'plate',
  'כוס': 'cup',
  'אסלה': 'toilet',
  'מקלחת': 'shower',
  
  // Games & Toys
  'משחק': 'game',
  'צעצוע': 'toy',
  'פאזל': 'puzzle',
  'שחמט': 'chess',
  'קלפים': 'cards',
  'דומינו': 'domino',
  'לגו': 'lego',
  'בובה': 'doll',
  'מכונית': 'car',
  'רחפן': 'drone',
  
  // General
  'חדש': 'new',
  'ישן': 'old',
  'גדול': 'large',
  'קטן': 'small',
  'אדום': 'red',
  'כחול': 'blue',
  'ירוק': 'green',
  'שחור': 'black',
  'לבן': 'white',
  'זהב': 'gold',
  'כסף': 'silver',
};

// Detect language of text (simple heuristic)
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'unknown';
  
  const trimmed = text.trim();
  
  // Check for Hebrew characters
  if (/[\u0590-\u05FF]/.test(trimmed)) return 'he';
  
  // Check for Arabic characters
  if (/[\u0600-\u06FF]/.test(trimmed)) return 'ar';
  
  // Check for Russian/Cyrillic characters
  if (/[\u0400-\u04FF]/.test(trimmed)) return 'ru';
  
  // Check for Chinese characters
  if (/[\u4E00-\u9FFF]/.test(trimmed)) return 'zh';
  
  // Check for Japanese characters
  if (/[\u3040-\u30FF]/.test(trimmed)) return 'ja';
  
  // Check for Korean characters
  if (/[\uAC00-\uD7AF]/.test(trimmed)) return 'ko';
  
  // Default to English (or unknown Latin script)
  return 'en';
}

// Simple dictionary-based translation (fast, no API calls)
function translateWithDictionary(text, sourceLang) {
  if (sourceLang !== 'he' || !text) return null;
  
  const words = text.split(/\s+/);
  const translatedWords = words.map(word => {
    const cleanedWord = word.replace(/[^\u0590-\u05FF]/g, ''); // Keep only Hebrew letters
    return HEBREW_TO_ENGLISH_DICT[cleanedWord] || word;
  });
  
  const translatedText = translatedWords.join(' ');
  
  // Only return if we actually translated at least one word
  if (translatedText !== text && translatedWords.some(word => HEBREW_TO_ENGLISH_DICT[word])) {
    return translatedText;
  }
  
  return null;
}

/**
 * Translate text using Google Translate (unofficial API)
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code (default: 'en')
 * @param {string} sourceLang - Source language code (auto-detected if not provided)
 * @returns {Promise<string|null>} Translated text or null if failed
 */
async function translateWithGoogle(text, targetLang = 'en', sourceLang = null) {
  if (!text || typeof text !== 'string') return null;
  
  // Don't translate if already in target language
  if (!sourceLang) sourceLang = detectLanguage(text);
  if (sourceLang === targetLang) return text;
  
  // Cache key
  const cacheKey = `translate:${sourceLang}:${targetLang}:${text}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[Translation] Cache hit for: "${text.substring(0, 30)}..." → "${cached}"`);
    return cached;
  }
  
  try {
    const url = 'https://translate.googleapis.com/translate_a/single';
    const params = {
      client: 'gtx',
      sl: sourceLang,
      tl: targetLang,
      dt: 't',
      q: text
    };
    
    console.log(`[Translation] Translating "${text.substring(0, 50)}..." (${sourceLang}→${targetLang})`);
    
    const response = await axios.get(url, {
      params,
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.data && response.data[0] && response.data[0][0] && response.data[0][0][0]) {
      const translatedText = response.data[0][0][0];
      console.log(`[Translation] Success: "${text.substring(0, 30)}..." → "${translatedText.substring(0, 30)}..."`);
      
      // Cache for 24 hours
      cache.set(cacheKey, translatedText, 24 * 60 * 60);
      
      return translatedText;
    }
  } catch (error) {
    console.error('[Translation] Google Translate API error:', error.message);
    
    // Don't throw - just return null to use fallback
    return null;
  }
  
  return null;
}

/**
 * Smart translation with fallback strategy
 * 1. Try dictionary translation (fast, for Hebrew)
 * 2. Try Google Translate API
 * 3. Fallback to extracting English words from mixed text
 * 4. Final fallback: return original text cleaned of non-Latin characters
 * 
 * @param {string} query - Search query to translate
 * @param {string} targetLang - Target language (default: 'en')
 * @returns {Promise<string>} Translated query
 */
async function translateQuery(query, targetLang = 'en') {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return query;
  }
  
  const sourceLang = detectLanguage(query);
  
  console.log(`[Translation] Processing query: "${query}" (detected: ${sourceLang})`);
  
  // If already in target language, just clean it
  if (sourceLang === targetLang || sourceLang === 'en') {
    console.log(`[Translation] Already in ${targetLang}, returning cleaned version`);
    return extractEnglishWords(query);
  }
  
  // Step 1: Try dictionary translation for Hebrew (fastest)
  if (sourceLang === 'he') {
    const dictTranslated = translateWithDictionary(query, sourceLang);
    if (dictTranslated) {
      console.log(`[Translation] Dictionary translation: "${query}" → "${dictTranslated}"`);
      return dictTranslated;
    }
  }
  
  // Step 2: Try Google Translate API
  try {
    const translated = await translateWithGoogle(query, targetLang, sourceLang);
    if (translated) {
      return translated;
    }
  } catch (error) {
    console.error('[Translation] Translation failed, using fallback:', error.message);
  }
  
  // Step 3: Extract English words from mixed text (e.g., "משחק שחמט chess wooden")
  const englishWords = extractEnglishWords(query);
  if (englishWords && englishWords.trim().length > 0) {
    console.log(`[Translation] Extracted English words: "${query}" → "${englishWords}"`);
    return englishWords;
  }
  
  // Step 4: Final fallback - return query with non-Latin characters removed
  const cleaned = query.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length > 0) {
    console.log(`[Translation] Final fallback (Latin only): "${query}" → "${cleaned}"`);
    return cleaned;
  }
  
  // If all else fails, return original
  console.log(`[Translation] All methods failed, returning original: "${query}"`);
  return query;
}

/**
 * Extract English words from mixed-language text
 * Useful for queries like "משחק שחמט chess wooden set"
 * @param {string} text - Mixed language text
 * @returns {string} English words only
 */
function extractEnglishWords(text) {
  if (!text) return '';
  
  // Match sequences of Latin letters (3+ characters)
  const englishRegex = /\b[a-zA-Z]{3,}\b/g;
  const matches = text.match(englishRegex);
  
  if (!matches || matches.length === 0) return '';
  
  // Filter out common noise words
  const noiseWords = new Set([
    'new', 'free', 'sale', 'hot', 'top', 'best', 'high', 'quality',
    'shipping', 'fast', 'express', 'delivery', 'worldwide', 'wholesale',
    'original', 'genuine', 'authentic', 'official', 'brand', '2024', '2025'
  ]);
  
  const filtered = matches
    .map(word => word.toLowerCase())
    .filter(word => !noiseWords.has(word))
    .filter((word, index, self) => self.indexOf(word) === index); // Remove duplicates
  
  return filtered.join(' ');
}

/**
 * Batch translate multiple queries (optimized)
 * @param {string[]} queries - Array of queries to translate
 * @param {string} targetLang - Target language
 * @returns {Promise<string[]>} Array of translated queries
 */
async function translateBatch(queries, targetLang = 'en') {
  if (!Array.isArray(queries) || queries.length === 0) return [];
  
  console.log(`[Translation] Batch translating ${queries.length} queries`);
  
  const results = [];
  const batchSize = 5; // Limit concurrent requests
  
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchPromises = batch.map(query => translateQuery(query, targetLang));
    
    try {
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    } catch (error) {
      console.error(`[Translation] Batch ${i/batchSize + 1} failed:`, error.message);
      // Fallback to individual translation for failed batch
      for (const query of batch) {
        try {
          const translated = await translateQuery(query, targetLang);
          results.push(translated);
        } catch (fallbackError) {
          console.error(`[Translation] Individual fallback failed for "${query}":`, fallbackError.message);
          results.push(query); // Return original
        }
      }
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < queries.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

module.exports = {
  translateQuery,
  translateBatch,
  detectLanguage,
  extractEnglishWords
};

// For backward compatibility
module.exports = translateQuery;