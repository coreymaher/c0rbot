"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const BigNumber = require("big-number");
const Discord = require("./lib/Discord");
const DotaAPI = require("./lib/DotaAPI");

// Loaded dynamically since DotaConstants is now ESM
let DotaConstants;

const environment = JSON.parse(process.env.environment);

const client = new DynamoDBClient({});
const discord = new Discord();
const docClient = DynamoDBDocumentClient.from(client);
const dotaAPI = new DotaAPI(environment.dota);

discord.init(environment.discord);

function formatNumber(number) {
  return number >= 1000 ? (number / 1000).toFixed(1) + "k" : number;
}

async function loadDBUsers(data) {
  try {
    const scanParams = {
      TableName: process.env.table,
    };

    const result = await docClient.send(new ScanCommand(scanParams));
    data.dbUsers = result.Items;
    return data;
  } catch (err) {
    console.error("DynamoDB.get error:");
    console.error(err);
    console.error({ TableName: process.env.table });
    return data;
  }
}

function loadRecentMatches(data) {
  const userPromises = data.dbUsers.map((user) => {
    return dotaAPI.getLatestMatch(user.steamID).then((response) => {
      const match = response.result.matches[0];
      if (match.match_id != user.last_matchID) {
        data.matches[match.match_id] = {};
        data.users[user.steamID] = {
          matchID: match.match_id,
        };
      }

      return Promise.resolve();
    });
  });

  return Promise.all(userPromises).then(() => {
    return Promise.resolve(data);
  });
}

function loadUsers(data) {
  const accountIDs = Object.keys(data.users).map((accountID) => {
    return new BigNumber("76561197960265728").plus(accountID).toString();
  });

  if (!accountIDs) {
    return Promise.resolve(data);
  }

  return dotaAPI.getPlayerSummaries(accountIDs).then((result) => {
    result.response.players.forEach((player) => {
      const accountID = new BigNumber(player.steamid)
        .minus("76561197960265728")
        .toString();

      data.users[accountID] = Object.assign(player, data.users[accountID]);
    });

    return Promise.resolve(data);
  });
}

function loadMatches(data) {
  const matchDetails = Object.keys(data.matches).map((matchID) => {
    return dotaAPI.getMatchDetails(matchID).then((response) => {
      data.matches[matchID] = response.result;
    });
  });

  return Promise.all(matchDetails).then(() => {
    return Promise.resolve(data);
  });
}

function loadMatchSkill(data) {
  const matchSkill = Object.keys(data.matches).map((matchID) => {
    const heroIDs = data.matches[matchID].players.map((player) => {
      return player.hero_id;
    });
    return dotaAPI.getMatchSkill(matchID, heroIDs).then((skillID) => {
      data.matches[matchID].skillID = skillID;
    });
  });

  return Promise.all(matchSkill).then(() => {
    return Promise.resolve(data);
  });
}

function sendDiscordMessage(data) {
  const userPromises = Object.keys(data.users).map((userID) => {
    const user = data.users[userID];
    const matchID = user.matchID;
    const match = data.matches[matchID];

    const dotaPlayer = match.players.reduce((player, curPlayer) => {
      let result = player;
      if (curPlayer.account_id == userID) {
        result = curPlayer;
      }

      return result;
    });

    const skill = DotaConstants.skillIDs[match.skillID];
    const lobby = DotaConstants.lobbyTypes[match.lobby_type];
    const gameMode = DotaConstants.gameModes[match.game_mode];
    const hero = DotaConstants.heroes[dotaPlayer.hero_id];
    const heroName = hero.name;
    const playerName = user.personaname;
    const isRadiant = dotaPlayer.player_slot < 128;
    const team = isRadiant ? "radiant" : "dire";
    const result = match.radiant_win == isRadiant ? "won" : "lost";
    const kills = dotaPlayer.kills;
    const deaths = dotaPlayer.deaths;
    const assists = dotaPlayer.assists;
    const gpm = dotaPlayer.gold_per_min;
    const xpm = dotaPlayer.xp_per_min;
    const heroDamage = formatNumber(dotaPlayer.hero_damage);
    const towerDamage = formatNumber(dotaPlayer.tower_damage);
    const heroHealing = formatNumber(dotaPlayer.hero_healing);
    const heroImage = hero.image;

    const thumbnail_url = `http://cdn.dota2.com/apps/dota2/images/heroes/${heroImage}_full.png`;

    let description = `${playerName} ${result} a `;
    if (skill) {
      description += `${skill} skill `;
    }
    description += `${lobby} ${gameMode} match as ${heroName}`;
    const embed = {
      author: {
        name: playerName,
        icon_url: user.avatar,
      },
      description: description,
      fields: [
        {
          name: "k / d / a",
          value: `${kills} / ${deaths} / ${assists}`,
          inline: true,
        },
        { name: "gpm / xpm", value: `${gpm} / ${xpm}`, inline: true },
        {
          name: "hd / td / hh",
          value: `${heroDamage} / ${towerDamage} / ${heroHealing}`,
          inline: true,
        },
        {
          name: "more",
          value: `[dotabuff](https://www.dotabuff.com/matches/${matchID}) | [opendota](https://opendota.com/matches/${matchID})`,
        },
      ],
      thumbnail: {
        url: thumbnail_url,
      },
    };

    return Promise.resolve(embed);
  });

  return Promise.all(userPromises)
    .then((embeds) => {
      let promise = Promise.resolve();

      embeds.forEach((embed) => {
        promise = promise.then(() => {
          return discord.sendEmbed(embed);
        });
      });

      return promise;
    })
    .then(() => {
      return Promise.resolve(data);
    });
}

function updateDB(data) {
  const userPromises = Object.keys(data.users).map((userID) => {
    const user = data.users[userID];

    const params = {
      TableName: process.env.table,
      Key: {
        steamID: userID,
      },
      UpdateExpression:
        "SET last_matchID = :last_matchID, updated_at = :updated_at, dotaname = :dotaname",
      ExpressionAttributeValues: {
        ":last_matchID": user.matchID,
        ":updated_at": Date.now(),
        ":dotaname": user.personaname,
      },
    };

    return (async () => {
      try {
        await docClient.send(new UpdateCommand(params));
      } catch (err) {
        console.error("DynamoDB.update error:");
        console.error(err);
        console.error(params);
      }
    })();
  });

  return Promise.all(userPromises).then(() => {
    return Promise.resolve(data);
  });
}

module.exports = async (event, context, callback) => {
  // Load ESM module dynamically
  if (!DotaConstants) {
    DotaConstants = (await import("./lib/DotaConstants.mjs")).default;
  }

  const sharedData = {
    dbUsers: [],
    users: {},
    matches: {},
  };

  return loadDBUsers(sharedData)
    .then(loadRecentMatches)
    .then(loadUsers)
    .then(loadMatches)
    .then(loadMatchSkill)
    .then(sendDiscordMessage)
    .then(updateDB)
    .then(() => {
      callback(null, { message: "Done" });
    });
};
