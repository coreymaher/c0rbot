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
      // Find the latest event of this type
      const latestEvent = data.events?.find(
        (event) => event.event_type === eventType.id,
      );

      if (!latestEvent) continue;

      const gid = latestEvent.gid;
      const lastSeenGid = lastSeenByType[eventType.id.toString()];

      // If we've seen this exact GID for this type, skip it
      if (gid === lastSeenGid) continue;

      const embed = {
        title: `There is a new ${game.name} ${eventType.name}`,
        description: latestEvent.event_name,
        url: `https://store.steampowered.com/news/app/${game.appid}/view/${gid}`,
        thumbnail: {
          url: game.thumbnail,
        },
      };

      const { discordError } = await discord.sendEmbed(embed, "updates");
      if (!discordError) {
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
