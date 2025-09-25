"use strict";

const request = require("request");
const querystring = require("querystring");

// Import cache as a dynamic import since it's an ESM module
let cache;
(async () => {
  cache = (await import("./cache.mjs")).default;
})();

const SEVEN_DAYS = 7 * 24 * 60 * 60;

function API() {
  const prefix = "https://api.opendota.com/api/";
  function getRequest(url, params) {
    params = params ? params : {};

    const requestUrl = `${prefix}${url}?${querystring.stringify(params)}`;

    return new Promise((resolve, reject) => {
      request(requestUrl, (err, response, body) => {
        if (err) {
          console.error(`request error ${url}:`);
          console.error(err);
        }
        resolve(JSON.parse(body));
      });
    });
  }

  async function getMatch(matchID) {
    const cacheNamespace = "opendota-matches";
    const cacheKey = `match:${matchID}`;

    // Check cache first
    if (cache) {
      const cachedMatch = await cache.get(cacheNamespace, cacheKey);
      if (cachedMatch) {
        console.log(`Cache hit for match ${matchID}`);
        return JSON.parse(cachedMatch);
      }
      console.log(`Cache miss for match ${matchID}`);
    }

    // Fetch from API
    const match = await getRequest(`matches/${matchID}`);

    if (cache && match?.od_data?.has_parsed) {
      await cache.set(cacheNamespace, cacheKey, JSON.stringify(match), SEVEN_DAYS);
      console.log(`Cached parsed match ${matchID}`);
    }

    return match;
  }

  function getRecentMatches(steamID) {
    return getRequest(`players/${steamID}/matches`, {
      limit: 10,
      significant: 0,
    });
  }

  function getPlayer(steamID) {
    return getRequest(`players/${steamID}`);
  }

  async function requestParse(matchID) {
    return await fetch(`${prefix}/request/${matchID}`, {
      method: "POST",
    });
  }

  this.getMatch = getMatch.bind(this);
  this.getRecentMatches = getRecentMatches.bind(this);
  this.getPlayer = getPlayer.bind(this);
  this.requestParse = requestParse.bind(this);
}

module.exports = new API();
