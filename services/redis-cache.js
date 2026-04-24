/**
 * Redis Cache Service
 * Caching layer using Redis with 5-10 minute TTL for API rate limiting protection
 * LAZY INITIALIZATION: Only connects when first operation is called
 */

const Redis = require('ioredis');

// Redis connection configuration
const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL || null;
const DEFAULT_TTL_SECONDS = 600; // 10 minutes default cache
const SHORT_TTL_SECONDS = 300;   // 5 minutes for frequently changing data

/** @type {Redis | null} */
let redis = null;
let redisAvailable = false;
let connectionAttempted = false;

/**
 * Initialize Redis connection - LAZY: only called on first operation
 * Prevents server hanging during startup if Redis is unavailable
 */
function initRedis() {
  if (redis || connectionAttempted) return redis;
  
  connectionAttempted = true;
  
  if (!REDIS_URL) {
    console.log('[Redis] No REDIS_URL configured, using in-memory fallback');
    return null;
  }
  
  try {
    console.log('[Redis] Lazy initialization starting...');
    
    redis = new Redis(REDIS_URL, {
      retryStrategy: (times) => {
        // Stop retrying after 3 attempts to prevent hanging
        if (times > 3) {
          console.log('[Redis] Max retries reached, giving up');
          redisAvailable = false;
          return null; // Stop retrying
        }
        const delay = Math.min(times * 100, 500);
        console.log(`[Redis] Retry ${times}, delay ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 2,
      enableReadyCheck: false, // DISABLED: Don't wait for ready check
      connectTimeout: 5000,      // REDUCED: 5 seconds max connection time
      lazyConnect: true,       // ENABLED: Don't connect until first command
      keepAlive: 30000,        // Keep connection alive
    });
    
    redis.on('connect', () => {
      console.log('[Redis] Connected successfully');
      redisAvailable = true;
    });
    
    redis.on('error', (err) => {
      // Only log critical errors, ignore connection noise
      if (err.message && !err.message.includes('ECONNREFUSED')) {
        console.error('[Redis] Error:', err.message);
      }
      redisAvailable = false;
    });
    
    redis.on('close', () => {
      redisAvailable = false;
    });
    
    return redis;
  } catch (error) {
    console.error('[Redis] Failed to initialize:', error.message);
    redisAvailable = false;
    return null;
  }
}

/**
 * Generate a deterministic cache key
 * @param {string} prefix - e.g. "search", "visual", "product"
 * @param {string} identifier - Search query, image URL, or product ID
 * @param {Object} params - Optional parameters for cache key variation
 * @returns {string}
 */
function generateCacheKey(prefix, identifier, params = {}) {
  const normalizedId = String(identifier || '').toLowerCase().trim().substring(0, 100);
  const { locale = 'en', currency = 'USD', country = 'US' } = params;
  return `alismart:${prefix}:${normalizedId}:${locale}:${currency}:${country}`;
}

/**
 * Get cached value with timeout protection
 * @param {string} key
 * @param {number} timeoutMs - Max time to wait for Redis (default 1000ms)
 * @returns {Promise<any | null>}
 */
async function get(key, timeoutMs = 1000) {
  const client = initRedis();
  if (!client) return null;
  
  // Race between Redis operation and timeout
  const redisPromise = (async () => {
    try {
      // Ensure connection is established (lazy connect)
      if (client.status === 'wait') {
        await client.connect().catch(() => {});
      }
      
      if (!redisAvailable) return null;
      
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  })();
  
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });
  
  return Promise.race([redisPromise, timeoutPromise]);
}

/**
 * Set cached value with TTL and timeout protection
 * @param {string} key
 * @param {any} value
 * @param {number} ttlSeconds - Time to live in seconds (default: 600 = 10 minutes)
 * @param {number} timeoutMs - Max time to wait for Redis (default 1000ms)
 */
async function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS, timeoutMs = 1000) {
  const client = initRedis();
  if (!client) return false;
  
  // Fire-and-forget with timeout - don't block if Redis is slow
  const redisPromise = (async () => {
    try {
      // Ensure connection is established (lazy connect)
      if (client.status === 'wait') {
        await client.connect().catch(() => {});
      }
      
      if (!redisAvailable) return false;
      
      const serialized = JSON.stringify(value);
      await client.setex(key, ttlSeconds, serialized);
      return true;
    } catch (error) {
      return false;
    }
  })();
  
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve(false), timeoutMs);
  });
  
  // Don't await - let it happen in background if slow
  return Promise.race([redisPromise, timeoutPromise]);
}

/**
 * Delete cached value
 * @param {string} key
 */
async function del(key) {
  if (!redis || !redisAvailable) {
    return false;
  }
  
  try {
    await redis.del(key);
    return true;
  } catch (error) {
    console.error('[Redis] DEL error:', error.message);
    return false;
  }
}

/**
 * Check if Redis is connected
 * @returns {boolean}
 */
function isConnected() {
  return redisAvailable && redis && redis.status === 'ready';
}

/**
 * Get cache stats
 * @returns {Promise<Object>}
 */
async function getStats() {
  if (!redis || !redisAvailable) {
    return { connected: false, keys: 0 };
  }
  
  try {
    const info = await redis.info('keyspace');
    const keysMatch = info.match(/keys=(\d+)/);
    return {
      connected: true,
      keys: keysMatch ? parseInt(keysMatch[1], 10) : 0,
      status: redis.status
    };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

/**
 * Get multiple values at once (pipeline)
 * @param {string[]} keys
 * @returns {Promise<(any | null)[]>}
 */
async function mget(keys) {
  if (!redis || !redisAvailable || keys.length === 0) {
    return keys.map(() => null);
  }
  
  try {
    const values = await redis.mget(...keys);
    return values.map(v => v ? JSON.parse(v) : null);
  } catch (error) {
    console.error('[Redis] MGET error:', error.message);
    return keys.map(() => null);
  }
}

/**
 * Set multiple values at once (pipeline)
 * @param {Array<{key: string, value: any}>} items
 * @param {number} ttlSeconds
 */
async function mset(items, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!redis || !redisAvailable || items.length === 0) {
    return false;
  }
  
  try {
    const pipeline = redis.pipeline();
    for (const { key, value } of items) {
      pipeline.setex(key, ttlSeconds, JSON.stringify(value));
    }
    await pipeline.exec();
    return true;
  } catch (error) {
    console.error('[Redis] MSET error:', error.message);
    return false;
  }
}

module.exports = {
  generateCacheKey,
  get,
  set,
  del,
  mget,
  mset,
  isConnected,
  getStats,
  DEFAULT_TTL_SECONDS,
  SHORT_TTL_SECONDS,
  initRedis
};
