"use strict";

import Discord from "../lib/Discord.js";
import { simpleGet, loadFeedData, updateFeedData } from "../utils.js";

const discord = new Discord();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

const games = [
  {
    appid: 322330,
    name: "Don't Starve Together",
    key: "dont-starve-together_updates",
    thumbnail:
      "https://vignette.wikia.nocookie.net/dont-starve-game/images/9/90/Don%27t_Starve_Together_Logo.png",
    eventTypes: [12, 13, 14, 28], // patches, hotfixes, updates, news
  },
  {
    appid: 1808500,
    name: "ARC Raiders",
    key: "arc-raiders_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1808500/logo.png",
    eventTypes: [12, 13, 14, 28], // patches, hotfixes, updates, news
  },
  {
    appid: 1757300,
    name: "Jump Space",
    key: "jump-space_updates",
    thumbnail:
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1757300/f401ae1af25f31fdfed24f56cf98ea4a32d79997/header.jpg",
    eventTypes: [12, 13, 14, 28], // patches, hotfixes, updates, news
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
        (event) => event.event_type === eventType,
      );

      if (!latestEvent) continue;

      const gid = latestEvent.gid;
      const lastSeenGid = lastSeenByType[eventType.toString()];

      // If we've seen this exact GID for this type, skip it
      if (gid === lastSeenGid) continue;

      // New event! Determine display name
      let eventTypeName = "news";
      if (eventType === 12) eventTypeName = "patch";
      if (eventType === 13) eventTypeName = "hotfix";
      if (eventType === 14) eventTypeName = "update";

      const embed = {
        title: `There is a new ${game.name} ${eventTypeName}`,
        description: latestEvent.event_name,
        url: `https://store.steampowered.com/news/app/${game.appid}/view/${gid}`,
        thumbnail: {
          url: game.thumbnail,
        },
      };

      const { discordError } = await discord.sendEmbed(embed, "updates");
      if (!discordError) {
        updatedTracking[eventType.toString()] = gid;
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
