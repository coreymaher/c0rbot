// @ts-check

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const API_PREFIX = "https://api.opendota.com/api/";
const CACHE_NAMESPACE = "opendota-matches";

export default class OpenDotaAPI {
  #cache;
  #timeout;

  // Timeout is per caller, not shared: the poller has 30s for a whole run, the analyst
  // 180s for one multi-megabyte parsed match.
  /**
   * @param {import("./cache.mjs").CacheLike | null} [cache]
   * @param {number} [timeout] milliseconds
   */
  constructor(cache = null, timeout = undefined) {
    this.#cache = cache;
    this.#timeout = timeout;
  }

  /**
   * @param {string} path
   * @param {Record<string, string>} [params]
   * @returns {Promise<any>} OpenDota's body, which this module does not model
   */
  async #getRequest(path, params) {
    const query = params ? `?${new URLSearchParams(params)}` : "";

    const response = await fetch(`${API_PREFIX}${path}${query}`, {
      signal: this.#timeout ? AbortSignal.timeout(this.#timeout) : undefined,
    });

    if (!response.ok) {
      throw new Error(`OpenDota ${path}: HTTP ${response.status}`);
    }

    return response.json();
  }

  /** @param {number|string} matchID */
  async getMatch(matchID) {
    const cacheKey = `match:${matchID}`;

    if (this.#cache) {
      const cachedMatch = await this.#cache.get(CACHE_NAMESPACE, cacheKey);
      if (cachedMatch) {
        console.log(`Cache hit for match ${matchID}`);
        return JSON.parse(cachedMatch);
      }
      console.log(`Cache miss for match ${matchID}`);
    }

    const match = await this.#getRequest(`matches/${matchID}`);

    // Unparsed matches are filled in later, so caching one would pin the gaps.
    if (this.#cache && match?.od_data?.has_parsed) {
      await this.#cache.set(
        CACHE_NAMESPACE,
        cacheKey,
        JSON.stringify(match),
        SEVEN_DAYS,
      );
      console.log(`Cached parsed match ${matchID}`);
    }

    return match;
  }

  /** @param {number|string} steamID */
  async getRecentMatches(steamID) {
    return this.#getRequest(`players/${steamID}/matches`, {
      limit: "10",
      significant: "0",
    });
  }

  /** @param {number|string} steamID */
  async getPlayer(steamID) {
    return this.#getRequest(`players/${steamID}`);
  }

  /** @param {number|string} heroID */
  async getHeroItemPopularity(heroID) {
    return this.#getRequest(`heroes/${heroID}/itemPopularity`);
  }

  /** @param {number|string} matchID */
  async requestParse(matchID) {
    const response = await fetch(`${API_PREFIX}request/${matchID}`, {
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(
        `Parse request failed for match ${matchID}: ${response.status} - ${body}`,
      );
    }

    return response;
  }
}
