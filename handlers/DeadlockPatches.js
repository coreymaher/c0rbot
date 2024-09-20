"use strict";

const cheerio = require("cheerio");

const Discord = require("../Discord");
const utils = require("../utils");

const discord = new Discord();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

module.exports.handler = async () => {
  const feed_name = "deadlock_patches";
  const db = await utils.loadFeedData(feed_name);

  const content = await utils.simpleGet(
    "https://forums.playdeadlock.com/forums/changelog.10/index.rss"
  );
  const $ = cheerio.load(content, { xmlMode: true });

  const item = $("item").first();
  const guid = item.find("guid").text();
  const title = item.find("title").text();
  const link = item.find("link").text();
  const description = item.find("content\\:encoded").html();

  const regex = /(- .*?)\<br /g;
  const changes = [];
  let match;
  while ((match = regex.exec(description))) {
    changes.push(match[1]);
  }

  if (!guid || !title) return;
  if (guid === db.Item?.feed_data) return;

  const fields = [];
  if (changes.length > 0) {
    fields.push({ name: "Changes", value: changes.slice(0, 5).join("\n") });
  }

  const embed = {
    title: "There is a new Deadlock patch post",
    description: title,
    url: link,
    thumbnail: {
      url: "https://deadlocked.wiki/images/thumb/a/a6/Deadlock_Logo.webp/625px-Deadlock_Logo.webp.png",
    },
    fields: fields,
  };

  const { discordError } = await discord.sendEmbed(embed, "updates");
  if (!discordError) {
    await utils.updateFeedData(feed_name, guid);
  }

  return { message: "Done" };
};
