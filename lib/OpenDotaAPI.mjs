import querystring from 'querystring';

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const API_PREFIX = 'https://api.opendota.com/api/';
const CACHE_NAMESPACE = 'opendota-matches';

/**
 * OpenDota API client with optional caching support.
 * Use constructor to inject a cache implementation or pass null for no caching.
 */
class OpenDotaAPI {
  #cache;

  /**
   * @param {Object|null} cache - Cache implementation with get/set methods, or null to disable caching
   */
  constructor(cache = null) {
    this.#cache = cache;
  }

  /**
   * Make a GET request to the OpenDota API
   * @private
   */
  async #getRequest(url, params = {}) {
    const requestUrl = `${API_PREFIX}${url}?${querystring.stringify(params)}`;

    try {
      const response = await fetch(requestUrl);
      if (!response.ok) {
        console.error(`OpenDota API error ${url}: ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      console.error(`Request error ${url}:`, err);
      throw err;
    }
  }

  /**
   * Get match data by match ID with optional caching
   * @param {string|number} matchID - Match ID
   * @returns {Promise<Object>} Match data
   */
  async getMatch(matchID) {
    const cacheKey = `match:${matchID}`;

    // Check cache first
    if (this.#cache) {
      const cachedMatch = await this.#cache.get(CACHE_NAMESPACE, cacheKey);
      if (cachedMatch) {
        console.log(`Cache hit for match ${matchID}`);
        return typeof cachedMatch === 'string'
          ? JSON.parse(cachedMatch)
          : cachedMatch;
      }
      console.log(`Cache miss for match ${matchID}`);
    }

    // Fetch from API
    const match = await this.#getRequest(`matches/${matchID}`);

    // Cache parsed matches
    if (this.#cache && match?.od_data?.has_parsed) {
      await this.#cache.set(CACHE_NAMESPACE, cacheKey, JSON.stringify(match), SEVEN_DAYS);
      console.log(`Cached parsed match ${matchID}`);
    }

    return match;
  }

  /**
   * Get recent matches for a player
   * @param {string|number} steamID - Steam account ID
   * @returns {Promise<Array>} Recent matches
   */
  async getRecentMatches(steamID) {
    return this.#getRequest(`players/${steamID}/matches`, {
      limit: 10,
      significant: 0,
    });
  }

  /**
   * Get player data
   * @param {string|number} steamID - Steam account ID
   * @returns {Promise<Object>} Player data
   */
  async getPlayer(steamID) {
    return this.#getRequest(`players/${steamID}`);
  }

  /**
   * Get hero item popularity statistics
   * @param {string|number} heroID - Hero ID
   * @returns {Promise<Object>} Item popularity data
   */
  async getHeroItemPopularity(heroID) {
    return this.#getRequest(`heroes/${heroID}/itemPopularity`);
  }

  /**
   * Request match parsing
   * @param {string|number} matchID - Match ID
   * @returns {Promise<Response>} Fetch response
   */
  async requestParse(matchID) {
    try {
      const response = await fetch(`${API_PREFIX}request/${matchID}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const responseText = await response.text();
        console.error(
          `Parse request failed for match ${matchID}: ${response.status} - ${responseText}`,
        );
      }

      return response;
    } catch (error) {
      console.error(`Parse request error for match ${matchID}:`, error);
      throw error;
    }
  }
}

// Export only the class
export default OpenDotaAPI;
