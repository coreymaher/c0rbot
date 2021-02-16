"use strict";

const cheerio = require("cheerio");

const Discord = require("../Discord");
const utils = require("../utils");

const discord = new Discord();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

module.exports.handler = async () => {
  const feed_name = "no-mans-sky_patches";
  const db = await utils.loadFeedData(feed_name);
  const content = await utils.simpleGet(
    "https://www.nomanssky.com/release-log/"
  );

  const $ = cheerio.load(content);
  const element = $(".grid__cell")
    .toArray()
    .find((el) => $(el).find(".platform--pc").length > 0);

  const item = $(element);
  const link = item.find("a").attr("href");
  const title = item.find(".grid__cell-content h2").text();

  if (!db.Item || db.Item.feed_data != link) {
    const embed = {
      title: "There is a new No Man's Sky update",
      description: title,
      url: link,
      thumbnail: {
        url: "https://www.nomanssky.com/wp-content/uploads/2017/02/logo.png",
      },
    };
    await discord.sendEmbed(embed, "updates");
    await utils.updateFeedData(feed_name, link);
  }

  return Promise.resolve({ message: "Done" });
};
