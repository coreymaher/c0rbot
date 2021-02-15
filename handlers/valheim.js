"use strict";

const Discord = require("../Discord");
const utils = require("../utils");

const discord = new Discord();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

module.exports.handler = async () => {
  const feed_name = "valheim_patches";
  const db = await utils.loadFeedData(feed_name);
  const json = await utils.simpleGet(
    "https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/?clan_accountid=33695701&appid=892970&count_after=3"
  );

  const data = JSON.parse(json);
  const event = data.events.find((item) =>
    /(\d+.\d+.\d+)/.exec(item.event_name)
  );

  if (event && (!db.Item || db.Item.feed_data != event.gidfeature)) {
    const id = event.gidfeature;
    const title = event.event_name;
    const link = `https://steamcommunity.com/games/892970/announcements/detail/${id}`;

    const embed = {
      title: "There is a new Valheim update",
      description: title,
      url: link,
      thumbnail: {
        url:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/892970/logo.png",
      },
    };
    await discord.sendEmbed(embed, "updates");
    await utils.updateFeedData(feed_name, id);
  }

  return Promise.resolve({ message: "Done" });
};
