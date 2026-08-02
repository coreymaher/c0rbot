"use strict";

import Discord from "../lib/Discord.js";
import { simpleGet, loadFeedData, updateFeedData } from "../utils.js";

const discord = new Discord();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

// Steam event types - https://github.com/SteamDatabase/Protobufs (EProtoClanEventType)
const EventType = {
  GAME_RELEASE: { id: 10, name: "game release" },
  HOTFIX: { id: 12, name: "hotfix" },
  UPDATE: { id: 13, name: "update" },
  MAJOR_UPDATE: { id: 14, name: "major update" },
  DLC_RELEASE: { id: 15, name: "DLC release" },
  NEWS: { id: 28, name: "news" },
  BETA_RELEASE: { id: 29, name: "beta release" },
  CONTENT_RELEASE: { id: 30, name: "content release" },
  SEASON_RELEASE: { id: 32, name: "season release" },
  SEASON_UPDATE: { id: 33, name: "season update" },
  IN_GAME_EVENT: { id: 35, name: "event" },
};

const DEFAULT_EVENT_TYPES = [
  EventType.HOTFIX,
  EventType.UPDATE,
  EventType.MAJOR_UPDATE,
  EventType.NEWS,
  EventType.IN_GAME_EVENT,
];

const games = [
  {
    appid: 322330,
    name: "Don't Starve Together",
    key: "dont-starve-together_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/322330/header.jpg",
    eventTypes: DEFAULT_EVENT_TYPES,
  },
  {
    appid: 1808500,
    name: "ARC Raiders",
    key: "arc-raiders_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1808500/header.jpg",
    eventTypes: DEFAULT_EVENT_TYPES,
  },
  {
    appid: 1757300,
    name: "Jump Space",
    key: "jump-space_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1757300/header.jpg",
    eventTypes: DEFAULT_EVENT_TYPES,
  },
  {
    appid: 251570,
    name: "7 Days to Die",
    key: "7-days-to-die_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/251570/header.jpg",
    eventTypes: DEFAULT_EVENT_TYPES,
  },
  {
    appid: 739630,
    name: "Phasmophobia",
    key: "phasmophobia_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/739630/header.jpg",
    eventTypes: DEFAULT_EVENT_TYPES,
  },
  {
    appid: 1943950,
    name: "Escape the Backrooms",
    key: "escape-the-backrooms_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1943950/header.jpg",
    eventTypes: DEFAULT_EVENT_TYPES,
  },
  {
    appid: 427410,
    name: "Abiotic Factor",
    key: "abiotic-factor_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/427410/header.jpg",
    eventTypes: DEFAULT_EVENT_TYPES,
  },
  {
    appid: 427520,
    name: "Factorio",
    key: "factorio_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/427520/header.jpg",
    eventTypes: DEFAULT_EVENT_TYPES,
  },
  {
    appid: 2868840,
    name: "Slay the Spire 2",
    key: "slay-the-spire-2_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/2868840/header.jpg",
    eventTypes: DEFAULT_EVENT_TYPES,
  },
  {
    appid: 570,
    name: "Dota 2",
    key: "dota2_news",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg",
    eventTypes: DEFAULT_EVENT_TYPES,
    // Valve serves these posts by gid on dota2.com too
    newsUrl: (gid) => `https://www.dota2.com/newsentry/${gid}`,
  },
];

async function processGame(game) {
  try {
    const db = await loadFeedData(game.key);
    const raw_data = await simpleGet(
      "https://store.steampowered.com/events/ajaxgetpartnereventspageable/",
      {
        qs: {
          clan_accountid: 0,
          appid: game.appid,
          offset: 0,
          count: 10,
          l: "english",
        },
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!raw_data) {
      console.log(
        `Failed to fetch data from Steam API for ${game.name} (transient issue)`,
      );
      return;
    }

    let data;
    try {
      data = JSON.parse(raw_data);
    } catch (parseError) {
      console.error(
        `Failed to parse JSON response for ${game.name}:`,
        parseError.message,
      );
      console.error("Response preview:", raw_data.substring(0, 200));
      return;
    }

    // Handle old string format or missing data - just start fresh
    const lastSeenByType =
      typeof db.Item?.feed_data === "object" ? db.Item.feed_data : {};

    let hasNewEvents = false;
    const updatedTracking = { ...lastSeenByType };

    // Check each event type we're tracking
    for (const eventType of game.eventTypes) {
      // Steam returns events newest-first, so the stored gid acts as a
      // watermark: everything above it in the list is still unposted.
      const typeEvents = (data.events ?? []).filter(
        (event) => event.event_type === eventType.id,
      );

      if (typeEvents.length === 0) continue;

      const lastSeenGid = lastSeenByType[eventType.id.toString()];
      const lastSeenIndex = typeEvents.findIndex(
        (event) => event.gid === lastSeenGid,
      );

      // No watermark in view - either a first run or we've fallen behind the
      // fetch window. Post only the newest so we can't flood the channel.
      const pending =
        lastSeenIndex === -1
          ? typeEvents.slice(0, 1)
          : typeEvents.slice(0, lastSeenIndex);

      // Oldest first, so a failed send leaves the watermark on the last event
      // we actually posted and the rest retry on the next run.
      for (const event of pending.reverse()) {
        const gid = event.gid;

        console.log(
          `new item: ${game.name} - ${eventType.name}(${eventType.id}) - ${gid} - ${event.event_name}`,
        );

        const embed = {
          title: `There is a new ${game.name} ${eventType.name}`,
          description: event.event_name,
          url: game.newsUrl
            ? game.newsUrl(gid)
            : `https://store.steampowered.com/news/app/${game.appid}/view/${gid}`,
          thumbnail: {
            url: game.thumbnail,
          },
        };

        const { error: discordError } = await discord.sendEmbed(
          embed,
          "updates",
        );
        if (discordError) {
          console.error(
            `failed to post ${game.name} - ${eventType.name}(${eventType.id}) - ${gid}`,
          );
          break;
        }

        updatedTracking[eventType.id.toString()] = gid;
        hasNewEvents = true;
      }
    }

    // Save updated tracking if we posted any new events
    if (hasNewEvents) {
      await updateFeedData(game.key, updatedTracking);
    }
  } catch (error) {
    console.error(`Error processing ${game.name}:`, error.message);
  }
}

export async function handler() {
  await Promise.all(games.map((game) => processGame(game)));
  return { message: "Done" };
}
