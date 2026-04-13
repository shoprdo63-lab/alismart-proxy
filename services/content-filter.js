/**
 * Content Safety Filter — Halachic Compliance
 *
 * Blocks products with inappropriate content based on halachic guidelines.
 * Operates as a blocklist — items are removed only on match, preserving all safe results.
 *
 * Categories covered:
 * - Tzniut (modesty) violations in clothing descriptions
 * - Adult / explicit content keywords
 * - Avodah Zarah (idolatry) related items
 * - Shatnez risk indicators (wool+linen mix in clothing)
 */

// Blocked keyword patterns — case-insensitive matching
const BLOCKED_PATTERNS = [
  // Tzniut / Immodest clothing descriptors
  /\b(sexy|seductive|provocative|see[\s-]?through|transparent|sheer|backless|deep[\s-]?v|plunging|thong|g[\s-]?string|lingerie|negligee|teddy[\s-]?lingerie|corset[\s-]?top|bustier|fishnet|stripper|pole[\s-]?dance)\b/i,
  
  // Explicit / Adult content
  /\b(adult[\s-]?toy|sex[\s-]?toy|vibrat(or|ing)|erotic|pornograph|xxx|bondage|fetish|bdsm|dildo|pleasure[\s-]?toy|intimate[\s-]?toy|adult[\s-]?game|strip[\s-]?poker|nude|naked)\b/i,
  
  // Avodah Zarah / Idolatry items
  /\b(buddha[\s-]?statue|idol[\s-]?worship|pagan[\s-]?altar|voodoo|ouija[\s-]?board|tarot[\s-]?card|crystal[\s-]?ball[\s-]?divination|pentagram[\s-]?necklace|occult[\s-]?ritual|satan(ic|ism)|demon[\s-]?worship|wicca[\s-]?altar|spell[\s-]?casting[\s-]?kit)\b/i,

  // Shatnez risk — wool + linen combination in same garment (clothing context)
  /\b(wool[\s-]?linen[\s-]?blend|linen[\s-]?wool[\s-]?mix)\b/i,

  // Gambling devices
  /\b(slot[\s-]?machine|roulette[\s-]?wheel|poker[\s-]?chip[\s-]?set|casino[\s-]?game|gambling[\s-]?kit)\b/i
];

// Secondary blocklist — exact word matches for shorter ambiguous terms
const BLOCKED_EXACT = new Set([
  'hookah', 'bong', 'grinder', 'rolling-papers'
]);

/**
 * Check if a product title/text matches any blocked pattern
 * @param {string} text - Product title or description
 * @returns {boolean} true if content should be blocked
 */
function isBlocked(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();

  // Check regex patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(lower)) return true;
  }

  // Check exact word blocklist
  const words = lower.split(/[\s\-_,;:!?.]+/);
  for (const word of words) {
    if (BLOCKED_EXACT.has(word)) return true;
  }

  return false;
}

/**
 * Filter an array of products, removing those with blocked content
 * @param {Object[]} products - Array of product objects (must have `title` field)
 * @returns {{ filtered: Object[], blockedCount: number }}
 */
function filterProducts(products) {
  if (!Array.isArray(products)) return { filtered: [], blockedCount: 0 };

  let blockedCount = 0;
  const filtered = products.filter(product => {
    const title = product.title || '';
    const category = product.category || '';
    const textToCheck = `${title} ${category}`;

    if (isBlocked(textToCheck)) {
      blockedCount++;
      return false;
    }
    return true;
  });

  if (blockedCount > 0) {
    console.log(`[ContentFilter] Blocked ${blockedCount} inappropriate items`);
  }

  return { filtered, blockedCount };
}

module.exports = { filterProducts, isBlocked };
