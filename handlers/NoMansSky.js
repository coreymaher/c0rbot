"use strict";

const cheerio = require("cheerio");

const Discord = require("../lib/Discord");
const utils = require("../utils");

const discord = new Discord();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

module.exports.handler = async () => {
  const feed_name = "no-mans-sky_patches";
  const db = await utils.loadFeedData(feed_name);
  const content = await utils.simpleGet(
    "https://www.nomanssky.com/release-log/",
  );

  const $ = cheerio.load(content);
  const element = $(".grid__cell")
    .toArray()
    .find((el) => $(el).find(".platform--pc").length > 0);

  const item = $(element);
  const link = item.find("a").attr("href");
  const version = item.find(".grid__cell-content h2").text();
  const description = item
    .find(".grid__cell-content p")
    .clone()
    .children()
    .remove()
    .end()
    .text()
    .trim();

  const full_link = link[0] === "/" ? `https://www.nomanssky.com${link}` : link;
  const short_description =
    description.length > 200 ? `${description.substr(0, 200)}...` : description;

  if (!db.Item || db.Item.feed_data != link) {
    const embed = {
      title: `There is a new No Man's Sky update: ${version}`,
      description: short_description,
      url: full_link,
      thumbnail: {
        url: "https://www.nomanssky.com/wp-content/uploads/2017/02/logo.png",
      },
    };
    await discord.sendEmbed(embed, "updates");
    await utils.updateFeedData(feed_name, link);
  }

  return Promise.resolve({ message: "Done" });
};
