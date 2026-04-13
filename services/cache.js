/**
 * In-Memory Cache with TTL
 * Redis-ready interface — swap implementation by replacing get/set/del methods.
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_ENTRIES = 500;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** @type {Map<string, { value: any, expiresAt: number }>} */
const store = new Map();

/**
 * Periodic eviction of expired entries
 */
function sweep() {
  const now = Date.now();
  let evicted = 0;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
      evicted++;
    }
  }
  if (evicted > 0) {
    console.log(`[Cache] Swept ${evicted} expired entries. Remaining: ${store.size}`);
  }
}

// Start periodic sweep
let sweepTimer = null;
function startSweep() {
  if (!sweepTimer) {
    sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
    // Allow process to exit even if timer is running (for serverless)
    if (sweepTimer.unref) sweepTimer.unref();
  }
}
startSweep();

/**
 * Evict oldest entries if we exceed MAX_ENTRIES
 */
function enforceLimit() {
  if (store.size <= MAX_ENTRIES) return;
  const entries = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const toRemove = store.size - MAX_ENTRIES;
  for (let i = 0; i < toRemove; i++) {
    store.delete(entries[i][0]);
  }
  console.log(`[Cache] Evicted ${toRemove} oldest entries to enforce limit of ${MAX_ENTRIES}`);
}

/**
 * Generate a deterministic cache key
 * @param {string} prefix - e.g. "search"
 * @param {string} mode - e.g. "exact", "visual"
 * @param {string} query - Search query or identifier
 * @returns {string}
 */
function cacheKey(prefix, mode, query) {
  const normalizedQuery = String(query || '').toLowerCase().trim();
  return `${prefix}:${mode}:${normalizedQuery}`;
}

/**
 * Get a cached value
 * @param {string} key
 * @returns {any|null} Cached value or null if miss/expired
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Set a cached value
 * @param {string} key
 * @param {any} value
 * @param {number} ttlMs - Time to live in ms (default 1 hour)
 */
function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
  enforceLimit();
}

/**
 * Delete a cached entry
 * @param {string} key
 */
function del(key) {
  store.delete(key);
}

/**
 * Get current cache stats
 * @returns {{ size: number, maxEntries: number, ttlMinutes: number }}
 */
function stats() {
  return {
    size: store.size,
    maxEntries: MAX_ENTRIES,
    ttlMinutes: DEFAULT_TTL_MS / 60000
  };
}

module.exports = { cacheKey, get, set, del, stats };
