import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import Discord from "../lib/Discord.mjs";
import OpenDotaAPI from "../lib/OpenDotaAPI.mjs";
import DotaConstants from "../lib/DotaConstants.mjs";
import cache from "../lib/cache.mjs";
import secrets from "../lib/secrets.mjs";
import tables from "../lib/tables.mjs";
import { withArticle } from "../lib/utils.mjs";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const openDotaAPI = new OpenDotaAPI(cache, 10_000);

const environment = await secrets();
const discord = new Discord(environment.discord);

function formatNumber(number) {
  return number >= 1000 ? (number / 1000).toFixed(1) + "k" : number;
}

async function loadDBUsers() {
  const scanParams = {
    TableName: process.env.table,
  };

  try {
    const result = await docClient.send(new ScanCommand(scanParams));
    return result.Items;
  } catch (err) {
    console.error("DynamoDB.get error:");
    console.error(err);
    console.error(scanParams);
    return [];
  }
}

async function loadConfig() {
  const scanParams = {
    TableName: tables.config,
    FilterExpression: "ConfigScope = :s",
    ExpressionAttributeValues: {
      ":s": "OpenDotaMatches",
    },
  };

  try {
    const result = await docClient.send(new ScanCommand(scanParams));
    return result.Items.reduce((config, item) => {
      config[item.Key] = item.Value;
      return config;
    }, {});
  } catch (err) {
    console.error("DynamoDB.get error:");
    console.error(err);
    console.error(scanParams);
    return {};
  }
}

async function collectNewMatches(dbUsers) {
  console.log(`Checking matches for ${dbUsers.length} users`);

  const users = {};
  const matches = {};

  await Promise.all(
    dbUsers.map(async (user) => {
      let recentMatches;
      // Only this stage is guarded. Later ones abort the run instead, which is safe:
      // updateDB never runs, so the next poll picks the same matches back up.
      try {
        recentMatches = await openDotaAPI.getRecentMatches(user.steamID);
      } catch (err) {
        console.error(`Recent matches failed for ${user.steamID}:`, err);
        recentMatches = [];
      }

      console.log(
        `User ${user.steamID}: got ${recentMatches.length} recent matches, last notified ${user.last_matchID}`,
      );

      // Match IDs increment, so a greater ID is a newer match.
      const newMatches = recentMatches.filter(
        (match) => match.match_id > user.last_matchID,
      );
      console.log(
        `User ${user.steamID}: found ${newMatches.length} new matches`,
      );

      if (newMatches.length === 0) {
        return;
      }

      newMatches.forEach((match) => {
        matches[match.match_id] = {};
        console.log(
          `New match queued: ${match.match_id} for user ${user.steamID}`,
        );
      });

      users[user.steamID] = {
        matches: newMatches
          .map((match) => match.match_id)
          .sort((a, b) => a - b),
      };
    }),
  );

  console.log(`Found ${Object.keys(matches).length} new matches to process`);

  return { users, matches };
}

async function loadPlayers(users) {
  await Promise.all(
    Object.keys(users).map(async (steamID) => {
      const player = await openDotaAPI.getPlayer(steamID);
      users[steamID] = Object.assign(player, users[steamID]);
    }),
  );
}

async function loadMatches(users, matches) {
  await Promise.all(
    Object.keys(matches).map(async (matchID) => {
      const match = await openDotaAPI.getMatch(matchID);
      matches[matchID] = match;
      match.players.forEach((player) => {
        if (player.account_id in users) {
          users[player.account_id].personaname = player.personaname;
        }
      });
    }),
  );
}

function getGameMode(modeID, config) {
  if (modeID === 19 && "event_name" in config) {
    return config.event_name;
  }

  return DotaConstants.gameModes[modeID];
}

function createDiscordMessageForMatch(steamID, user, matchID, match, config) {
  const dotaPlayer = match.players.find(
    (player) => player.account_id == steamID,
  );

  // OpenDota reports account_id as null for players who have not exposed their match
  // data, so a tracked player can be missing from their own match. Skip that match
  // rather than dereferencing undefined: every embed is built before the first send,
  // so one throw here would drop the whole run's notifications, and it would throw
  // again on every retry because updateDB never advances past the match.
  if (!dotaPlayer) {
    console.error(
      `No player ${steamID} in match ${matchID}, skipping notification`,
    );
    return null;
  }

  const skill = DotaConstants.skillIDs[match.skill];
  const lobby = DotaConstants.lobbyTypes[match.lobby_type];
  const gameMode = getGameMode(match.game_mode, config);
  const hero = DotaConstants.heroes[dotaPlayer.hero_id];
  const isRadiant = dotaPlayer.player_slot < 128;
  const result = match.radiant_win == isRadiant ? "won" : "lost";
  const heroDamage = formatNumber(dotaPlayer.hero_damage);
  const towerDamage = formatNumber(dotaPlayer.tower_damage);
  const heroHealing = formatNumber(dotaPlayer.hero_healing);
  const MMRs = match.players
    .map((player) => {
      return player.solo_competitive_rank;
    })
    .filter((rank) => {
      return rank;
    });
  const rankTiers = match.players
    .map((player) => {
      return player.rank_tier;
    })
    .filter((rank) => {
      return rank;
    });
  const durationHours = Math.floor(match.duration / 3600);
  const durationMinutes = Math.floor((match.duration % 3600) / 60);
  const durationSeconds = Math.floor(match.duration % 60);
  let duration = "";
  if (durationHours > 0) {
    duration += `${durationHours}h `;
  }
  duration += `${durationMinutes}m ${durationSeconds}s`;

  const thumbnail_url = `http://cdn.dota2.com/apps/dota2/images/dota_react/heroes/${hero.image}.png`;

  const played = withArticle(
    skill && `${skill} skill`,
    lobby,
    gameMode,
    "match",
  );
  const description = `${user.personaname} ${result} ${played} as ${hero.name}`;
  const embed = {
    author: {
      name: user.personaname,
      icon_url: user.profile.avatar,
    },
    description: description,
    fields: [
      {
        name: "k / d / a",
        value: `${dotaPlayer.kills} / ${dotaPlayer.deaths} / ${dotaPlayer.assists}`,
        inline: true,
      },
      {
        name: "gpm / xpm",
        value: `${dotaPlayer.gold_per_min} / ${dotaPlayer.xp_per_min}`,
        inline: true,
      },
      {
        name: "hd / td / hh",
        value: `${heroDamage} / ${towerDamage} / ${heroHealing}`,
        inline: true,
      },
      { name: "duration", value: duration, inline: true },
    ],
    thumbnail: {
      url: thumbnail_url,
    },
  };

  if (MMRs.length > 1) {
    const estimatedMMR =
      MMRs.reduce((total, rank) => {
        return (total += parseInt(rank, 10));
      }, 0) / MMRs.length;
    embed.fields.push({
      name: "mmr",
      value: Math.round(estimatedMMR),
      inline: true,
    });
  }

  if (rankTiers.length > 1) {
    const totalTierIndex = rankTiers
      .map((rank) => {
        return DotaConstants.rankTierValues.indexOf(rank);
      })
      .reduce((total, rank) => {
        return (total += rank);
      }, 0);
    const estimatedTierIndex = Math.round(totalTierIndex / rankTiers.length);
    const estimatedTier = DotaConstants.rankTierValues[estimatedTierIndex];
    const tier = Math.floor(estimatedTier / 10);
    const subTier = estimatedTier % 10;
    embed.fields.push({
      name: "tier",
      value: `${DotaConstants.rankTiers[tier]} ${subTier}`,
      inline: true,
    });
  }

  embed.fields.push({
    name: "more",
    value: `[dotabuff](https://www.dotabuff.com/matches/${matchID}) | [opendota](https://opendota.com/matches/${matchID})`,
  });

  const components = [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: "Analyze",
          custom_id: `ai:${matchID}:${steamID}`,
        },
      ],
    },
  ];

  return { embed, components };
}

// Resolves each user's newest announced match, which is what their watermark may
// advance to. A user whose first match failed to send is absent.
async function sendDiscordMessages(users, matches, config) {
  const queue = [];

  Object.keys(users).forEach((steamID) => {
    const user = users[steamID];

    // Already oldest first, so stopping at a failure leaves the watermark on the
    // last match that reached Discord.
    user.matches.forEach((matchID) => {
      queue.push({
        steamID,
        matchID,
        message: createDiscordMessageForMatch(
          steamID,
          user,
          matchID,
          matches[matchID],
          config,
        ),
      });
    });
  });

  const announced = {};
  const stalled = new Set();

  // Sequential on purpose. Promise.all here would post the embeds in whatever order
  // Discord answers, and would drop the spacing that keeps a burst of matches under
  // the rate limit.
  for (const { steamID, matchID, message } of queue) {
    if (stalled.has(steamID)) {
      continue;
    }

    if (message) {
      const { error } = await discord.sendEmbed(
        message.embed,
        "results",
        message.components,
      );

      if (error) {
        stalled.add(steamID);
        continue;
      }
    }

    // A match with no embed to build still counts as handled -- retrying it would
    // come up empty every poll and pin the watermark forever.
    announced[steamID] = matchID;
  }

  return announced;
}

async function updateDB(users, announced) {
  await Promise.all(
    Object.keys(announced).map(async (steamID) => {
      const user = users[steamID];

      const params = {
        TableName: process.env.table,
        Key: {
          steamID: steamID,
        },
        UpdateExpression:
          "SET last_matchID = :last_matchID, updated_at = :updated_at, dotaname = :dotaname",
        ExpressionAttributeValues: {
          ":last_matchID": announced[steamID],
          ":updated_at": Date.now(),
          ":dotaname": user.personaname,
        },
      };

      try {
        await docClient.send(new UpdateCommand(params));
      } catch (err) {
        console.error("DynamoDB.update error:");
        console.error(err);
        console.error(params);
      }
    }),
  );
}

export async function handler() {
  const dbUsers = await loadDBUsers();
  const config = await loadConfig();

  const { users, matches } = await collectNewMatches(dbUsers);
  await loadPlayers(users);
  await loadMatches(users, matches);
  const announced = await sendDiscordMessages(users, matches, config);
  await updateDB(users, announced);

  return { message: "Done" };
}
