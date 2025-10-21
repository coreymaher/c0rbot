const SEVEN_DAYS = 7 * 24 * 60 * 60;
const API_PREFIX = 'https://api.deadlock-api.com/v1/';
const CACHE_NAMESPACE = 'deadlock-matches';

/**
 * Deadlock API client with optional caching support.
 * Use constructor to inject a cache implementation or pass null for no caching.
 */
class DeadlockAPI {
  #cache;

  /**
   * @param {Object|null} cache - Cache implementation with get/set methods, or null to disable caching
   */
  constructor(cache = null) {
    this.#cache = cache;
  }

  /**
   * Fetch match metadata from Deadlock API
   * @private
   */
  async #fetchMatchMetadataFromAPI(matchId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const url = `${API_PREFIX}matches/${matchId}/metadata`;

    try {
      const res = await fetch(url, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        console.error(`Failed to fetch match metadata: ${res.status}`);
        return null;
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  /**
   * Get match metadata by match ID with optional caching
   * @param {string|number} matchId - Match ID
   * @param {Object} options - Options
   * @param {boolean} options.skipCache - Skip cache lookup and storage
   * @returns {Promise<Object|null>} Match metadata or null if not found
   */
  async getMatchMetadata(matchId, { skipCache = false } = {}) {
    const cacheKey = `metadata:${matchId}`;

    // Check cache first (unless skipped)
    if (!skipCache && this.#cache) {
      const cachedMetadata = await this.#cache.get(CACHE_NAMESPACE, cacheKey);
      if (cachedMetadata) {
        console.log(`Cache hit for match metadata ${matchId}`);
        return typeof cachedMetadata === 'string'
          ? JSON.parse(cachedMetadata)
          : cachedMetadata;
      }
      console.log(`Cache miss for match metadata ${matchId}`);
    }

    // Fetch from API
    try {
      const data = await this.#fetchMatchMetadataFromAPI(matchId);
      if (!data) return null;

      // Cache the metadata for 7 days (unless skipped)
      if (!skipCache && this.#cache) {
        await this.#cache.set(CACHE_NAMESPACE, cacheKey, JSON.stringify(data), SEVEN_DAYS);
        console.log(`Cached match metadata ${matchId}`);
      }

      return data;
    } catch (err) {
      console.error(`Failed to fetch match metadata: ${err}`);
      return null;
    }
  }
}

// Export only the class
export default DeadlockAPI;
