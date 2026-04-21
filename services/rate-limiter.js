/**
 * Rate Limiter & Debounce Protection
 * Prevents abuse from multiple rapid requests and provides debounce functionality
 * Uses in-memory cache with TTL for tracking request counts
 */

const cache = require('./cache.js');

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 30; // 30 requests per minute per IP
const DEBOUNCE_WINDOW_MS = 2000; // 2 seconds debounce window for identical requests

/**
 * Get client identifier from request
 * In production, use IP address; for development/testing, use combination of headers
 * @param {Object} req - Express request object
 * @returns {string} Client identifier
 */
function getClientId(req) {
  // Try to get IP from various headers (common in proxy environments)
  const ip = req.headers['x-forwarded-for'] || 
             req.headers['x-real-ip'] || 
             req.connection?.remoteAddress || 
             req.socket?.remoteAddress || 
             'unknown';
  
  // Extract first IP if it's a list
  const clientIp = String(ip).split(',')[0].trim();
  return `rate:${clientIp}`;
}

/**
 * Get request fingerprint for debouncing
 * Identical requests within debounce window should be throttled
 * @param {Object} req - Express request object
 * @returns {string} Request fingerprint
 */
function getRequestFingerprint(req) {
  const { q, searchMode, productId, imgUrl, locale } = req.query || {};
  
  // Create a deterministic fingerprint from key parameters
  const params = {
    q: String(q || '').substring(0, 100),
    searchMode: searchMode || 'exact',
    productId: productId || '',
    imgUrl: imgUrl || '',
    locale: locale || 'en'
  };
  
  return `debounce:${JSON.stringify(params)}`;
}

/**
 * Check if request is rate limited
 * @param {string} clientId - Client identifier
 * @returns {{ limited: boolean, remaining: number, resetMs: number }}
 */
function checkRateLimit(clientId) {
  const now = Date.now();
  const windowKey = `${clientId}:window`;
  const countKey = `${clientId}:count`;
  
  // Get current window and count from cache
  const windowStart = cache.get(windowKey) || now;
  let requestCount = cache.get(countKey) || 0;
  
  // If window has expired, reset
  if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
    requestCount = 0;
    cache.set(windowKey, now, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    cache.set(countKey, 1, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    return { limited: false, remaining: MAX_REQUESTS_PER_WINDOW - 1, resetMs: RATE_LIMIT_WINDOW_MS };
  }
  
  // Increment count
  requestCount++;
  cache.set(countKey, requestCount, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - windowStart)) / 1000));
  
  const remaining = Math.max(0, MAX_REQUESTS_PER_WINDOW - requestCount);
  const resetMs = RATE_LIMIT_WINDOW_MS - (now - windowStart);
  
  return {
    limited: requestCount > MAX_REQUESTS_PER_WINDOW,
    remaining,
    resetMs
  };
}

/**
 * Check if request should be debounced (identical recent request)
 * @param {string} fingerprint - Request fingerprint
 * @returns {{ debounced: boolean, lastRequestTime: number|null }}
 */
function checkDebounce(fingerprint) {
  const now = Date.now();
  const debounceKey = `${fingerprint}:debounce`;
  const lastRequestTime = cache.get(debounceKey);
  
  if (lastRequestTime && (now - lastRequestTime < DEBOUNCE_WINDOW_MS)) {
    // Request is within debounce window
    return { debounced: true, lastRequestTime };
  }
  
  // Update last request time
  cache.set(debounceKey, now, Math.ceil(DEBOUNCE_WINDOW_MS / 1000));
  return { debounced: false, lastRequestTime };
}

/**
 * Apply rate limiting middleware to API handler
 * @param {Function} handler - Original API handler
 * @returns {Function} Wrapped handler with rate limiting
 */
function withRateLimit(handler) {
  return async function(req, res) {
    // Apply CORS first
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    const clientId = getClientId(req);
    const rateLimitResult = checkRateLimit(clientId);
    
    // Check rate limit
    if (rateLimitResult.limited) {
      console.warn(`[RateLimit] Client ${clientId} exceeded rate limit. Remaining: ${rateLimitResult.remaining}, Reset in: ${rateLimitResult.resetMs}ms`);
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: `Too many requests. Please try again in ${Math.ceil(rateLimitResult.resetMs / 1000)} seconds.`,
        retryAfter: Math.ceil(rateLimitResult.resetMs / 1000)
      });
    }
    
    // Check debounce for non-OPTIONS GET requests
    if (req.method === 'GET') {
      const fingerprint = getRequestFingerprint(req);
      const debounceResult = checkDebounce(fingerprint);
      
      if (debounceResult.debounced) {
        console.log(`[Debounce] Similar request detected for ${fingerprint}. Last request: ${debounceResult.lastRequestTime}`);
        // Return cached response if available, otherwise proceed with slight delay
        const cacheKey = `debounce:response:${fingerprint}`;
        const cachedResponse = cache.get(cacheKey);
        
        if (cachedResponse) {
          console.log(`[Debounce] Returning cached response for identical request`);
          return res.status(200).json({
            ...cachedResponse,
            debounced: true,
            cached: true
          });
        }
      }
    }
    
    // Add rate limit headers to response
    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS_PER_WINDOW);
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + rateLimitResult.resetMs) / 1000));
    
    // Call original handler
    return handler(req, res);
  };
}

/**
 * Get current rate limit stats for monitoring
 * @returns {Object} Statistics
 */
function getStats() {
  // This would require tracking all client IDs, which we don't store
  // For simplicity, return configuration
  return {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: MAX_REQUESTS_PER_WINDOW,
    debounceWindowMs: DEBOUNCE_WINDOW_MS,
    description: 'Rate limiting protects against abuse while allowing legitimate use'
  };
}

module.exports = {
  withRateLimit,
  checkRateLimit,
  checkDebounce,
  getStats,
  getClientId,
  getRequestFingerprint
};