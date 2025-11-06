const SEVEN_DAYS = 7 * 24 * 60 * 60;
const ONE_DAY = 24 * 60 * 60;
const API_PREFIX = "https://api.deadlock-api.com/v1/";
const CACHE_NAMESPACE = "deadlock-matches";
const POPULAR_ITEMS_CACHE_NAMESPACE = "deadlock-popular-items";

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
        return typeof cachedMetadata === "string"
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
        await this.#cache.set(
          CACHE_NAMESPACE,
          cacheKey,
          JSON.stringify(data),
          SEVEN_DAYS,
        );
        console.log(`Cached match metadata ${matchId}`);
      }

      return data;
    } catch (err) {
      console.error(`Failed to fetch match metadata: ${err}`);
      return null;
    }
  }

  /**
   * Fetch popular items from Deadlock API analytics endpoint
   * @private
   */
  async #fetchPopularItemsFromAPI(heroId, minBadge, minMatches) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    // Calculate 7 days ago in Unix timestamp
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

    const url = `${API_PREFIX}analytics/item-stats?hero_ids=${heroId}&min_average_badge=${minBadge}&min_unix_timestamp=${sevenDaysAgo}&min_matches=${minMatches}`;

    try {
      const res = await fetch(url, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        console.error(`Failed to fetch popular items: ${res.status}`);
        return null;
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  /**
   * Get popular items for a hero at a skill level with optional caching
   * @param {number} heroId - Hero ID
   * @param {number} minBadge - Minimum average badge (rank) to filter by
   * @param {Object} options - Options
   * @param {boolean} options.skipCache - Skip cache lookup and storage
   * @param {number} options.minMatches - Minimum number of matches required (default: 100)
   * @returns {Promise<Array|null>} Array of popular items sorted by win rate, or null if not found
   */
  async getPopularItems(
    heroId,
    minBadge,
    { skipCache = false, minMatches = 100 } = {},
  ) {
    const cacheKey = `popular-items:hero-${heroId}:badge-${minBadge}:minMatches-${minMatches}:v2`;

    // Check cache first (unless skipped)
    if (!skipCache && this.#cache) {
      const cachedItems = await this.#cache.get(
        POPULAR_ITEMS_CACHE_NAMESPACE,
        cacheKey,
      );
      if (cachedItems) {
        console.log(
          `Cache hit for popular items hero=${heroId} badge=${minBadge}`,
        );
        return typeof cachedItems === "string"
          ? JSON.parse(cachedItems)
          : cachedItems;
      }
      console.log(
        `Cache miss for popular items hero=${heroId} badge=${minBadge}`,
      );
    }

    // Fetch from API (filtering by minMatches is done server-side)
    try {
      const data = await this.#fetchPopularItemsFromAPI(
        heroId,
        minBadge,
        minMatches,
      );
      if (!data) return null;

      // Calculate win rate and sort by win rate (descending)
      const itemsWithWinRate = Array.isArray(data)
        ? data.map((item) => ({
            ...item,
            win_rate:
              item.wins != null && item.losses != null
                ? (item.wins / (item.wins + item.losses)) * 100
                : 0,
          }))
        : [];

      // Sort by win rate (descending)
      const sortedItems = itemsWithWinRate.sort(
        (a, b) => b.win_rate - a.win_rate,
      );

      // Cache the popular items for 24 hours (unless skipped)
      if (!skipCache && this.#cache) {
        await this.#cache.set(
          POPULAR_ITEMS_CACHE_NAMESPACE,
          cacheKey,
          JSON.stringify(sortedItems),
          ONE_DAY,
        );
        console.log(`Cached popular items hero=${heroId} badge=${minBadge}`);
      }

      return sortedItems;
    } catch (err) {
      console.error(`Failed to fetch popular items: ${err}`);
      return null;
    }
  }
}

// Export only the class
export default DeadlockAPI;
