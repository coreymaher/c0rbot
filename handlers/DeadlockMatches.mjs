"use strict";

import AWS from "aws-sdk";

const docClient = new AWS.DynamoDB.DocumentClient();

import Discord from "../Discord.js";
import { simpleGet } from "../utils.js";
import * as constants from "../DeadlockConstants.mjs";

const discord = new Discord();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

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

  return constants.ranks[rank] ? `${constants.ranks[rank]} ${subrank}` : null;
}

async function handleMatch(match, user) {
  console.log(`Found match: ${match.match_id}`);
  const result = match.match_result === match.player_team ? "won" : "lost";
  const hero = constants.heroes[match.hero_id];

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
    value: `[Stats](https://statlocker.gg/match/${match.match_id})`,
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

export async function handler() {
  const users = await loadDBUsers();

  for (const user of users) {
    console.log(
      `Loading the latest matches for: ${user.name} (${user.player_id})`
    );

    const content = await simpleGet(
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
}
