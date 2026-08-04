const SEVEN_DAYS = 7 * 24 * 60 * 60;
const API_PREFIX = "https://api.opendota.com/api/";
const CACHE_NAMESPACE = "opendota-matches";
const TIMEOUT_MS = 10000;

export default class OpenDotaAPI {
  #cache;

  /** @param {{get, set}|null} cache - omit to disable caching */
  constructor(cache = null) {
    this.#cache = cache;
  }

  async #getRequest(path, params) {
    const query = params ? `?${new URLSearchParams(params)}` : "";

    const response = await fetch(`${API_PREFIX}${path}${query}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`OpenDota ${path}: HTTP ${response.status}`);
    }

    return response.json();
  }

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

    // Only parsed matches are worth keeping: an unparsed one is missing the fields
    // the analyst reads, and OpenDota fills them in later.
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

  async getRecentMatches(steamID) {
    return this.#getRequest(`players/${steamID}/matches`, {
      limit: 10,
      significant: 0,
    });
  }

  async getPlayer(steamID) {
    return this.#getRequest(`players/${steamID}`);
  }

  async getHeroItemPopularity(heroID) {
    return this.#getRequest(`heroes/${heroID}/itemPopularity`);
  }

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
