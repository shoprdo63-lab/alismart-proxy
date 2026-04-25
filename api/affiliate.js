/**
 * Affiliate Link Endpoint - Lightweight Server
 * POST /api/affiliate
 * 
 * Body:
 * - productUrl: string (AliExpress product URL)
 * 
 * Returns affiliate link with tracking ID
 */

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const EXTENSION_ID = process.env.EXTENSION_ID || '';
const TRACKING_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';

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

  const { productUrl } = req.body || {};

  if (!productUrl || typeof productUrl !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid productUrl parameter'
    });
  }

  try {
    // Generate affiliate link
    const affiliateLink = generateAffiliateLink(productUrl, TRACKING_ID);
    
    return res.status(200).json({
      success: true,
      originalUrl: productUrl,
      affiliateLink: affiliateLink,
      trackingId: TRACKING_ID
    });
  } catch (error) {
    console.error('[Affiliate] Error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate affiliate link',
      message: error.message
    });
  }
}

/**
 * Generate AliExpress affiliate link
 * Converts regular product URL to affiliate tracking URL
 */
function generateAffiliateLink(productUrl, trackingId) {
  // Clean the URL first
  let cleanUrl = productUrl.trim();
  
  // Remove existing affiliate parameters
  cleanUrl = cleanUrl.split('?')[0];
  
  // Extract product ID from various URL formats
  const productId = extractProductId(cleanUrl);
  
  if (!productId) {
    throw new Error('Could not extract product ID from URL');
  }
  
  // Build affiliate link
  // AliExpress affiliate format: https://s.click.aliexpress.com/e/_xxxxx with deep linking
  // Or use the API format for better tracking
  const affiliateUrl = `https://s.click.aliexpress.com/deep_link.htm?aff_short_key=${trackingId}&dl_target_url=${encodeURIComponent(cleanUrl)}`;
  
  console.log(`[Affiliate] ${productId} -> affiliate link generated`);
  
  return affiliateUrl;
}

/**
 * Extract product ID from AliExpress URL
 */
function extractProductId(url) {
  // Match patterns like:
  // https://www.aliexpress.com/item/1234567890.html
  // https://aliexpress.com/item/1234567890.html
  // https://www.aliexpress.us/item/1234567890.html
  
  const patterns = [
    /\/item\/(\d+)\.html/,
    /\/item\/(\d+)/,
    /[?&]item_id=(\d+)/,
    /product\/(\d+)/,
    /(\d{10,})/  // Generic 10+ digit product ID
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}
