/**
 * No-op cache implementation for testing.
 * Provides the same interface as the real DynamoDB cache but does nothing.
 */
export default {
  /**
   * Always returns null (cache miss)
   * @param {string} key - Cache key
   * @returns {Promise<null>}
   */
  async get(key) {
    return null;
  },

  /**
   * Does nothing (no storage)
   * @param {string} key - Cache key
   * @param {any} value - Value to store
   * @param {number} ttl - Time to live in seconds (ignored)
   * @returns {Promise<void>}
   */
  async set(key, value, ttl) {
    // No-op
  },
};
