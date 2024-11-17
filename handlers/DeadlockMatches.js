"use strict";

const AWS = require("aws-sdk");

const Discord = require("../Discord");
const utils = require("../utils");

const discord = new Discord();
const docClient = new AWS.DynamoDB.DocumentClient();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

const heroURLs = {
  abrams:
    "https://cdn.wikimg.net/en/deadlockwiki/images/9/99/Bull_card_psd.png",
  bebop:
    "https://cdn.wikimg.net/en/deadlockwiki/images/6/62/Bebop_card_psd.png",
  dynamo:
    "https://cdn.wikimg.net/en/deadlockwiki/images/f/fc/Sumo_card_psd.png",
  "grey talon":
    "https://cdn.wikimg.net/en/deadlockwiki/images/5/53/Archer_card_psd.png",
  haze: "https://cdn.wikimg.net/en/deadlockwiki/images/7/7b/Haze_card_psd.png",
  infernus:
    "https://cdn.wikimg.net/en/deadlockwiki/images/b/b4/Inferno_card_psd.png",
  ivy: "https://cdn.wikimg.net/en/deadlockwiki/images/1/17/Tengu_card_psd.png",
  kelvin:
    "https://cdn.wikimg.net/en/deadlockwiki/images/4/45/Kelvin_card_psd.png",
  "lady geist":
    "https://cdn.wikimg.net/en/deadlockwiki/images/6/67/Spectre_card_psd.png",
  lash: "https://cdn.wikimg.net/en/deadlockwiki/images/c/c3/Lash_card_psd.png",
  mcginnis:
    "https://cdn.wikimg.net/en/deadlockwiki/images/4/4e/Engineer_card_psd.png",
  "mo & krill":
    "https://cdn.wikimg.net/en/deadlockwiki/images/d/d2/Digger_card_psd.png",
  paradox:
    "https://cdn.wikimg.net/en/deadlockwiki/images/4/4a/Chrono_card_psd.png",
  pocket:
    "https://cdn.wikimg.net/en/deadlockwiki/images/4/42/Synth_card_psd.png",
  seven:
    "https://cdn.wikimg.net/en/deadlockwiki/images/1/11/Gigawatt_card_psd.png",
  shiv: "https://cdn.wikimg.net/en/deadlockwiki/images/2/29/Shiv_card_psd.png",
  vindicta:
    "https://cdn.wikimg.net/en/deadlockwiki/images/b/b4/Hornet_card_psd.png",
  viscous:
    "https://cdn.wikimg.net/en/deadlockwiki/images/5/5c/Viscous_card_psd.png",
  warden:
    "https://cdn.wikimg.net/en/deadlockwiki/images/b/ba/Warden_card_psd.png",
  wraith:
    "https://cdn.wikimg.net/en/deadlockwiki/images/c/cb/Wraith_card_psd.png",
  yamato:
    "https://cdn.wikimg.net/en/deadlockwiki/images/c/cb/Yamato_card_psd.png",
};

const scanParams = {
  TableName: "matches",
  FilterExpression: "game = :s",
  ExpressionAttributeValues: {
    ":s": "deadlock",
  },
};

async function loadDBUsers() {
  try {
    const data = await docClient.scan(scanParams).promise();
    return data.Items;
  } catch (ex) {
    console.error(`DynamoDB.get error: ${ex}`);
  }

  return [];
}

async function updateDB(playerID, lastMatchID) {
  const params = {
    TableName: "matches",
    Key: {
      player_id: playerID,
      game: "deadlock",
    },
    UpdateExpression:
      "SET last_match_id = :last_match_id, updated_at = :updated_at",
    ExpressionAttributeValues: {
      ":last_match_id": lastMatchID,
      ":updated_at": Date.now(),
    },
  };

  try {
    await docClient.update(params).promise();
  } catch (ex) {
    console.error(`DynamoDB.update error: ${ex}`);
  }
}

function formatNumber(number) {
  return number >= 1000 ? (number / 1000).toFixed(1) + "k" : number;
}

function formatDuration(duration) {
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = Math.floor(duration % 60);

  const parts = [`${minutes}m`, `${seconds}s`];
  if (hours) {
    parts.unshift(`${hours}h`);
  }

  return parts.join(" ");
}

async function refreshProfile(accountId) {
  const content = await utils.simpleGet(
    "https://tracklock.gg/api/players/refresh",
    { qs: { account_id: accountId }, timeout: 5000 }
  );
  if (!content) return { parsed: null, raw: content };

  return {
    parsed: JSON.parse(content),
    raw: content,
  };
}

async function handleMatch(match, user) {
  console.log(`Found match: ${match.match_id}`);
  const result = match.match_result === match.player_team ? "won" : "lost";

  const matchType = match.match_mode === 4 ? "a Ranked" : "an Unranked";

  const description = `${user.name} ${result} ${matchType} Deadlock match as ${match.hero_name}`;
  const fields = [];

  fields.push({
    name: "k / d / a",
    value: `${match.player_kills} / ${match.player_deaths} / ${match.player_assists}`,
    inline: true,
  });

  fields.push({
    name: "last hits / denies",
    value: `${match.last_hits} / ${match.denies}`,
    inline: true,
  });

  fields.push({
    name: "souls",
    value: formatNumber(match.net_worth),
    inline: true,
  });

  fields.push({
    name: "duration",
    value: formatDuration(match.match_duration_s),
    inline: true,
  });

  let thumbnail = undefined;
  if (match.hero_name.toLowerCase() in heroURLs) {
    thumbnail = {
      url: heroURLs[match.hero_name.toLowerCase()],
    };
  }

  fields.push({
    name: "more",
    value: `[tracklock](https://tracklock.gg/players/${user.player_id})`,
  });

  const embed = {
    author: {
      name: user.name,
      icon_url: user.avatar || undefined,
    },
    description,
    fields,
    thumbnail,
  };

  return await discord.sendEmbed(embed, "results");
}

module.exports.handler = async () => {
  const users = await loadDBUsers();

  for (const user of users) {
    console.log(
      `Loading the latest matches for: ${user.name} (${user.player_id})`
    );

    console.log("Refreshing profile");
    const refreshResponse = await refreshProfile(user.player_id);
    if (refreshResponse.parsed?.success) {
      console.log("Profile refreshed");
    } else {
      console.log(`Unable to refresh profile: ${refreshResponse.raw}`);
    }

    const content = await utils.simpleGet(
      "https://tracklock.gg/api/matches/player",
      {
        qs: {
          offset: 0,
          account_id: user.player_id,
          hero_id: "all",
          match_mode: "all",
        },
        timeout: 5000,
      }
    );

    if (!content) {
      console.error("Unable to load data");
      continue;
    }

    const matches = JSON.parse(content);
    const seenIndex = matches.findIndex(
      (match) => match.match_id == user.last_match_id
    );
    if (seenIndex === -1) {
      seenIndex = matches.length;
    }
    if (seenIndex === 0) {
      console.log("No new match found");
      continue;
    }

    const results = await Promise.all(
      matches
        .slice(0, seenIndex)
        .reverse()
        .map(async (match) => await handleMatch(match, user))
    );
    const successful = results.some(({ error }) => !error);

    if (successful) {
      await updateDB(user.player_id, matches[0].match_id);
    }
  }

  return { message: "Done" };
};
