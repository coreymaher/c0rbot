"use strict";

import cache from "./cache.mjs";

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const CACHE_NAMESPACE = "deadlock-matches";

async function getMatchMetadata(matchId) {
  const cacheKey = `metadata:${matchId}`;

  // Check cache first
  const cachedMetadata = await cache.get(CACHE_NAMESPACE, cacheKey);
  if (cachedMetadata) {
    console.log(`Cache hit for match metadata ${matchId}`);
    return JSON.parse(cachedMetadata);
  }
  console.log(`Cache miss for match metadata ${matchId}`);

  // Fetch from API
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const url = `https://api.deadlock-api.com/v1/matches/${matchId}/metadata`;
    const res = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`Failed to fetch match metadata: ${res.status}`);
      return null;
    }

    const data = await res.json();

    // Cache the metadata for 7 days
    await cache.set(
      CACHE_NAMESPACE,
      cacheKey,
      JSON.stringify(data),
      SEVEN_DAYS,
    );
    console.log(`Cached match metadata ${matchId}`);

    return data;
  } catch (err) {
    console.error(`Failed to fetch match metadata: ${err}`);
    return null;
  }
}

export default {
  getMatchMetadata,
};
