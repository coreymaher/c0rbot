// @ts-check

"use strict";

import Discord from "../lib/Discord.mjs";
import secrets from "../lib/secrets.mjs";
import { simpleGet, loadFeedData, updateFeedData } from "../lib/utils.mjs";

const environment = await secrets();
const discord = new Discord(environment.discord);

const FEED_NAME = "no-mans-sky_patches";
const FEED_URL = "https://www.nomanssky.com/feed/";

// This is the whole news stream -- announcements, press, anniversaries -- not the
// release log. A version number in the title is what separates a patch post from
// the rest, and has been Hello Games' convention across every release since 2016.
const VERSIONED = /\d+\.\d+/;

/** @type {Record<string, string>} */
const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** @param {string} text */
function decodeEntities(text) {
  return (
    text
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
      // Left as-is if the alternation above ever outruns the table.
      .replace(
        /&(amp|lt|gt|quot|apos);/g,
        (m, name) => NAMED_ENTITIES[name] ?? m,
      )
  );
}

const CDATA = /^<!\[CDATA\[([\s\S]*)\]\]>$/;

// Scoped to one <item>: <channel> opens with its own <title> and <link>, which an
// unscoped match would take instead.
/**
 * @param {string} item
 * @param {string} name
 */
function tagText(item, name) {
  const match = item.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`),
  );
  if (!match) return "";

  const raw = (match[1] ?? "").trim();
  const unwrapped = raw.match(CDATA);
  return decodeEntities((unwrapped?.[1] ?? raw).trim());
}

export async function handler() {
  const db = await loadFeedData(FEED_NAME);
  const feed = await simpleGet(FEED_URL);

  if (!feed) {
    console.log("Failed to fetch the No Man's Sky feed (transient issue)");
    return { message: "Done" };
  }

  // Throws rather than returning early: a feed that fetched but will not parse has
  // changed shape, and only a failed invocation reaches CloudWatch's Errors metric.
  const items = feed.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/g) ?? [];

  if (items.length === 0) {
    throw new Error(
      `No <item> elements in ${FEED_URL} -- its shape has changed`,
    );
  }

  const item = items.find((entry) => VERSIONED.test(tagText(entry, "title")));

  if (!item) {
    throw new Error(
      `No versioned title among ${items.length} items in ${FEED_URL} -- the naming convention has changed`,
    );
  }

  const title = tagText(item, "title");
  const link = tagText(item, "link");

  if (!title || !link) {
    throw new Error(`Feed item is missing a title or link in ${FEED_URL}`);
  }

  // The watermark predates this handler and stores a path, not an absolute URL.
  // Normalising keeps the existing row valid instead of re-posting the last patch.
  const path = new URL(link).pathname;

  if (!db.Item || db.Item.feed_data != path) {
    console.log(`new item: No Man's Sky - ${path} - ${title}`);

    const embed = {
      title: `There is a new No Man's Sky update: ${title}`,
      url: link,
      thumbnail: {
        url: "https://cdn.cloudflare.steamstatic.com/steam/apps/275850/header.jpg",
      },
    };

    await discord.sendEmbed(embed, "updates");
    await updateFeedData(FEED_NAME, path);
  }

  return { message: "Done" };
}
