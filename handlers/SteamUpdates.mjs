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
    eventTypes: [12, 14, 28], // patches, updates, news
  },
  {
    appid: 1808500,
    name: "ARC Raiders",
    key: "arc-raiders_updates",
    thumbnail:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1808500/logo.png",
    eventTypes: [12, 14, 28], // patches, updates, news
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

    // Find the first event matching the configured event types
    const event = data.events?.find((event) =>
      game.eventTypes.includes(event.event_type),
    );

    if (!event) return;

    const gid = event.gid;
    const title = event.event_name;

    // Determine event type for display
    let eventType = "news";
    if (event.event_type === 12) eventType = "patch";
    if (event.event_type === 14) eventType = "update";

    if (gid === db.Item?.feed_data) return;

    const embed = {
      title: `There is a new ${game.name} ${eventType}`,
      description: title,
      url: `https://store.steampowered.com/news/app/${game.appid}/view/${gid}`,
      thumbnail: {
        url: game.thumbnail,
      },
    };

    const { discordError } = await discord.sendEmbed(embed, "updates");
    if (!discordError) {
      await updateFeedData(game.key, gid);
    }
  } catch (error) {
    console.error(`Error processing ${game.name}:`, error.message);
  }
}

export async function handler() {
  await Promise.all(games.map((game) => processGame(game)));
  return { message: "Done" };
}
