"use strict";

const Discord = require("../lib/Discord");
const utils = require("../utils");

const discord = new Discord();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

module.exports.handler = async () => {
  const feed_name = "loop-hero_patches";
  const db = await utils.loadFeedData(feed_name);
  const json = await utils.simpleGet(
    "https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/?clan_accountid=39322174&appid=1282730&count_after=3",
  );

  const patch_event_types = [12];

  const data = JSON.parse(json);
  const event = data.events.find((item) =>
    patch_event_types.includes(item.event_type),
  );
  const id = event.announcement_body ? event.announcement_body.gid : null;

  if (event && id && (!db.Item || db.Item.feed_data != id)) {
    const title = event.event_name;
    const link = `https://steamcommunity.com/games/1282730/announcements/detail/${id}`;

    const embed = {
      title: "There is a new Loop Hero update",
      description: title,
      url: link,
      thumbnail: {
        url: "https://cdn.cloudflare.steamstatic.com/steam/apps/1282730/logo.png",
      },
    };
    await discord.sendEmbed(embed, "updates");
    await utils.updateFeedData(feed_name, id);
  }

  return Promise.resolve({ message: "Done" });
};
