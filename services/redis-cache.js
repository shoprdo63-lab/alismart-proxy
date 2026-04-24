/**
 * Redis Cache Service
 * Caching layer using Redis with 5-10 minute TTL for API rate limiting protection
 */

const Redis = require('ioredis');

// Redis connection configuration
const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL || null;
const DEFAULT_TTL_SECONDS = 600; // 10 minutes default cache
const SHORT_TTL_SECONDS = 300;   // 5 minutes for frequently changing data

/** @type {Redis | null} */
let redis = null;
let redisAvailable = false;

/**
 * Initialize Redis connection
 */
function initRedis() {
  if (redis) return redis;
  
  if (!REDIS_URL) {
    console.log('[Redis] No REDIS_URL configured, using in-memory fallback');
    return null;
  }
  
  try {
    redis = new Redis(REDIS_URL, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10000,
    });
    
    redis.on('connect', () => {
      console.log('[Redis] Connected successfully');
      redisAvailable = true;
    });
    
    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
      redisAvailable = false;
    });
    
    redis.on('close', () => {
      console.log('[Redis] Connection closed');
      redisAvailable = false;
    });
    
    return redis;
  } catch (error) {
    console.error('[Redis] Failed to initialize:', error.message);
    return null;
  }
}

// Initialize on module load
initRedis();

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
 * Get cached value
 * @param {string} key
 * @returns {Promise<any | null>}
 */
async function get(key) {
  if (!redis || !redisAvailable) {
    return null;
  }
  
  try {
    const value = await redis.get(key);
    if (value) {
      return JSON.parse(value);
    }
    return null;
  } catch (error) {
    console.error('[Redis] GET error:', error.message);
    return null;
  }
}

/**
 * Set cached value with TTL
 * @param {string} key
 * @param {any} value
 * @param {number} ttlSeconds - Time to live in seconds (default: 600 = 10 minutes)
 */
async function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!redis || !redisAvailable) {
    return false;
  }
  
  try {
    const serialized = JSON.stringify(value);
    await redis.setex(key, ttlSeconds, serialized);
    return true;
  } catch (error) {
    console.error('[Redis] SET error:', error.message);
    return false;
  }
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
