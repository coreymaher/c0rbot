"use strict";

const AWS = require("aws-sdk");

const Discord = require("../Discord");
const utils = require("../utils");

const discord = new Discord();
const docClient = new AWS.DynamoDB.DocumentClient();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

const heroes = {
  1: {
    name: "Infernus",
    image: "https://assets.deadlock-api.com/images/heroes/inferno_card.png",
  },
  2: {
    name: "Seven",
    image: "https://assets.deadlock-api.com/images/heroes/gigawatt_card.png",
  },
  3: {
    name: "Vindicta",
    image: "https://assets.deadlock-api.com/images/heroes/hornet_card.png",
  },
  4: {
    name: "Lady Geist",
    image: "https://assets.deadlock-api.com/images/heroes/spectre_card.png",
  },
  6: {
    name: "Abrams",
    image: "https://assets.deadlock-api.com/images/heroes/bull_card.png",
  },
  7: {
    name: "Wraith",
    image: "https://assets.deadlock-api.com/images/heroes/wraith_card.png",
  },
  8: {
    name: "McGinnis",
    image: "https://assets.deadlock-api.com/images/heroes/engineer_card.png",
  },
  10: {
    name: "Paradox",
    image: "https://assets.deadlock-api.com/images/heroes/chrono_card.png",
  },
  11: {
    name: "Dynamo",
    image: "https://assets.deadlock-api.com/images/heroes/sumo_card.png",
  },
  12: {
    name: "Kelvin",
    image: "https://assets.deadlock-api.com/images/heroes/kelvin_card.png",
  },
  13: {
    name: "Haze",
    image: "https://assets.deadlock-api.com/images/heroes/haze_card.png",
  },
  14: {
    name: "Holliday",
    image: "https://assets.deadlock-api.com/images/heroes/astro_card.png",
  },
  15: {
    name: "Bebop",
    image: "https://assets.deadlock-api.com/images/heroes/bebop_card.png",
  },
  16: {
    name: "Calico",
    image: "https://assets.deadlock-api.com/images/heroes/nano_card.png",
  },
  17: {
    name: "Grey Talon",
    image: "https://assets.deadlock-api.com/images/heroes/archer_card.png",
  },
  18: {
    name: "Mo & Krill",
    image: "https://assets.deadlock-api.com/images/heroes/digger_card.png",
  },
  19: {
    name: "Shiv",
    image: "https://assets.deadlock-api.com/images/heroes/shiv_card.png",
  },
  20: {
    name: "Ivy",
    image: "https://assets.deadlock-api.com/images/heroes/tengu_card.png",
  },
  21: {
    name: "Kali",
    image: "https://assets.deadlock-api.com/images/heroes/kali_card.png",
  },
  25: {
    name: "Warden",
    image: "https://assets.deadlock-api.com/images/heroes/warden_card.png",
  },
  27: {
    name: "Yamato",
    image: "https://assets.deadlock-api.com/images/heroes/yamato_card.png",
  },
  31: {
    name: "Lash",
    image: "https://assets.deadlock-api.com/images/heroes/lash_card.png",
  },
  35: {
    name: "Viscous",
    image: "https://assets.deadlock-api.com/images/heroes/viscous_card.png",
  },
  38: {
    name: "Gunslinger",
    image: "https://assets.deadlock-api.com/images/heroes/gunslinger_sm.png",
  },
  39: {
    name: "The Boss",
    image: "https://assets.deadlock-api.com/images/heroes/yakuza_sm.png",
  },
  47: {
    name: "Tokamak",
    image:
      "https://assets.deadlock-api.com/images/hud/hero_portraits/tokamak_hud.png",
  },
  48: {
    name: "Wrecker",
    image: "https://assets.deadlock-api.com/images/heroes/wrecker_card.png",
  },
  49: {
    name: "Rutger",
    image: "https://assets.deadlock-api.com/images/heroes/rutger_card.png",
  },
  50: {
    name: "Pocket",
    image: "https://assets.deadlock-api.com/images/heroes/synth_card.png",
  },
  51: {
    name: "Thumper",
    image: "https://assets.deadlock-api.com/images/heroes/thumper_sm.png",
  },
  52: {
    name: "Mirage",
    image: "https://assets.deadlock-api.com/images/heroes/mirage_card.png",
  },
  53: {
    name: "Fathom",
    image: "https://assets.deadlock-api.com/images/heroes/slork_card.png",
  },
  54: {
    name: "Cadence",
    image: "https://assets.deadlock-api.com/images/heroes/cadence_sm.png",
  },
  56: {
    name: "Bomber",
    image: "",
  },
  57: {
    name: "Shield Guy",
    image: "",
  },
  58: {
    name: "Vyper",
    image: "https://assets.deadlock-api.com/images/heroes/kali_card.png",
  },
  59: {
    name: "Vandal",
    image: "https://assets.deadlock-api.com/images/heroes/vandal_card.png",
  },
  60: {
    name: "The Magnificent Sinclair",
    image: "https://assets.deadlock-api.com/images/heroes/magician_card.png",
  },
  61: {
    name: "Trapper",
    image: "https://assets.deadlock-api.com/images/heroes/trapper_card.png",
  },
  62: {
    name: "Raven",
    image: "https://assets.deadlock-api.com/images/heroes/operative_card.png",
  },
};

const ranks = [
  "Obscurus",
  "Initiate",
  "Seeker",
  "Alchemist",
  "Arcanist",
  "Ritualist",
  "Emissary",
  "Archon",
  "Oracle",
  "Phantom",
  "Ascendant",
  "Eternus",
];

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

function formatRank(average) {
  if (average == null) return null;

  const rank = Math.floor(average / 10);
  const subrank = average % 10;

  return ranks[rank] ? `${ranks[rank]} ${subrank}` : null;
}

async function handleMatch(match, user) {
  console.log(`Found match: ${match.match_id}`);
  const result = match.match_result === match.player_team ? "won" : "lost";
  const hero = heroes[match.hero_id];

  const description = `${user.name} ${result} a Deadlock match as ${hero.name}`;
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

  const rank = formatRank(match.average_match_badge);
  if (rank) {
    fields.push({
      name: "rank",
      value: rank,
      inline: true,
    });
  }

  let thumbnail = undefined;
  if (hero.image) {
    thumbnail = {
      url: hero.image,
    };
  }

  fields.push({
    name: "more",
    value: `[Stats](https://deadlock.blast.tv/matches/${match.match_id})`,
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

    const content = await utils.simpleGet(
      `https://api.deadlock-api.com/v1/players/${user.player_id}/match-history`,
      {
        timeout: 5000,
      }
    );

    if (!content) {
      console.error("Unable to load data");
      continue;
    }

    const data = JSON.parse(content);
    const seenIndex = data.findIndex(
      (match) => match.match_id == user.last_match_id
    );
    if (seenIndex === -1) {
      seenIndex = data.length;
    }
    if (seenIndex === 0) {
      console.log("No new match found");
      continue;
    }

    const results = await Promise.all(
      data
        .slice(0, seenIndex)
        .reverse()
        .map(async (match) => await handleMatch(match, user))
    );
    const successful = results.some(({ error }) => !error);

    if (successful) {
      await updateDB(user.player_id, data[0].match_id);
    }
  }

  return { message: "Done" };
};
