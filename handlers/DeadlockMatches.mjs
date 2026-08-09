"use strict";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

import Discord from "../lib/Discord.mjs";
import { simpleGet, withArticle } from "../lib/utils.mjs";
import * as constants from "../lib/DeadlockConstants.mjs";
import DeadlockAPI from "../lib/DeadlockAPI.mjs";
import cache from "../lib/cache.mjs";
import secrets from "../lib/secrets.mjs";
import tables from "../lib/tables.mjs";

const deadlockAPI = new DeadlockAPI(cache);

const environment = await secrets();
const discord = new Discord(environment.discord);

const scanParams = {
  TableName: tables.matches,
  FilterExpression: "game = :s",
  ExpressionAttributeValues: {
    ":s": "deadlock",
  },
};

async function loadDBUsers() {
  try {
    const data = await docClient.send(new ScanCommand(scanParams));
    return data.Items;
  } catch (ex) {
    console.error(`DynamoDB.get error: ${ex}`);
  }

  return [];
}

async function updateDB(playerID, lastMatchID) {
  const params = {
    TableName: tables.matches,
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
    await docClient.send(new UpdateCommand(params));
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

async function handleMatch(match, user) {
  console.log(`Found match: ${match.match_id}`);

  // Always fetch match metadata to warm cache for analyst
  const metadata = await deadlockAPI.getMatchMetadata(match.match_id);

  // Skip matches with fewer than 2 real players (solo bot matches)
  if (metadata?.match_info?.players) {
    const realPlayerCount = metadata.match_info.players.filter(
      (p) => p.account_id > 0,
    ).length;
    if (realPlayerCount < 2) {
      console.log(
        `Skipping match with only ${realPlayerCount} real player(s): ${match.match_id}`,
      );
      return { skipped: true };
    }
  }

  const result = match.match_result === match.player_team ? "won" : "lost";
  const hero = constants.heroes[match.hero_id];

  const played = withArticle(
    constants.matchModes[metadata?.match_info?.match_mode],
    "Deadlock",
    constants.gameModes[metadata?.match_info?.game_mode],
    "match",
  );
  const description = `${user.name} ${result} ${played} as ${hero.name}`;
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

  const rank = constants.formatBadge(
    await deadlockAPI.getMatchAverageBadge(metadata?.match_info),
  );

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

  const components = [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: "Analyze",
          custom_id: `ai_dl:${match.match_id}:${user.player_id}`,
        },
      ],
    },
  ];

  return await discord.sendEmbed(embed, "results", components);
}

export async function handler() {
  const users = await loadDBUsers();

  for (const user of users) {
    console.log(
      `Loading the latest matches for: ${user.name} (${user.player_id})`,
    );

    const content = await simpleGet(
      `https://api.deadlock-api.com/v1/players/${user.player_id}/match-history`,
      {
        timeout: 5000,
      },
    );

    if (!content) {
      console.error("Unable to load data");
      continue;
    }

    const data = JSON.parse(content);

    if (!Array.isArray(data)) {
      console.error(
        `Unexpected API response for ${user.name} (${user.player_id}):`,
        data,
      );
      continue;
    }

    let seenIndex = data.findIndex(
      (match) => match.match_id == user.last_match_id,
    );
    if (seenIndex === -1) {
      seenIndex = data.length;
    }
    if (seenIndex === 0) {
      console.log("No new match found");
      continue;
    }

    // Oldest first, so the watermark only ever steps forward over matches that
    // were announced. Stopping at the first failure leaves the rest to the next
    // run rather than skipping past them or re-sending what already landed.
    const newMatches = data.slice(0, seenIndex).reverse();
    for (const match of newMatches) {
      const { error } = await handleMatch(match, user);
      if (error) break;

      await updateDB(user.player_id, match.match_id);
    }
  }

  return { message: "Done" };
}
