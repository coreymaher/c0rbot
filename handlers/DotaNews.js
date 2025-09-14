"use strict";

const Discord = require("../Discord");
const utils = require("../utils");

const discord = new Discord();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

module.exports.handler = async () => {
  const feed_name = "dota2_news";
  const db = await utils.loadFeedData(feed_name);
  const raw_data = await utils.simpleGet(
    "https://store.steampowered.com/events/ajaxgetpartnereventspageable/",
    {
      qs: {
        clan_accountid: 0,
        appid: 570,
        offset: 0,
        count: 10,
        l: "english",
        origin: "https://www.dota2.com",
      },
      headers: {
        Accept: "application/json",
      },
    },
  );

  const data = JSON.parse(raw_data);
  const event = data.events.find((event) =>
    [12, 14].includes(event.event_type),
  );

  if (!event) return;

  const gid = event.gid;
  const title = event.event_name;
  const eventType = event.event_type === 14 ? "blog post" : "patch";

  if (gid === db.Item?.feed_data) return;

  const embed = {
    title: `There is a new Dota 2 ${eventType}`,
    description: title,
    url: `https://www.dota2.com/newsentry/${gid}`,
    thumbnail: {
      url: "http://vignette3.wikia.nocookie.net/defenseoftheancients/images/6/64/Dota_2_Logo_only.png/revision/latest",
    },
  };

  const { discordError } = await discord.sendEmbed(embed, "updates");
  if (!discordError) {
    await utils.updateFeedData(feed_name, gid);
  }

  return { message: "Done" };
};
