"use strict";

const AWS = require("aws-sdk");
const Discord = require("./Discord");
const OpenDotaAPI = require("./OpenDotaAPI");
const DotaConstants = require("./DotaConstants");

const environment = JSON.parse(process.env.environment);

const discord = new Discord();
const docClient = new AWS.DynamoDB.DocumentClient();

discord.init(environment.discord);

function formatNumber(number) {
  return number >= 1000 ? (number / 1000).toFixed(1) + "k" : number;
}

function loadDBUsers(data) {
  return new Promise((resolve, reject) => {
    const scanParams = {
      TableName: process.env.table,
    };

    docClient.scan(scanParams, (err, result) => {
      if (err) {
        console.error("DynamoDB.get error:");
        console.error(err);
        console.error(scanParams);
      }

      data.dbUsers = result.Items;

      resolve(data);
    });
  });
}

function loadConfig(data) {
  const scanParams = {
    TableName: "config",
    FilterExpression: "ConfigScope = :s",
    ExpressionAttributeValues: {
      ":s": "OpenDotaMatches",
    },
  };

  return new Promise((resolve, reject) => {
    docClient.scan(scanParams, (err, result) => {
      if (err) {
        console.error("DynamoDB.get error:");
        console.error(err);
        console.error(scanParams);
      }

      data.config = result.Items.reduce((config, item) => {
        config[item.Key] = item.Value;
        return config;
      }, {});

      resolve(data);
    });
  });
}

function loadRecentMatches(data) {
  const userPromises = data.dbUsers.map((user) => {
    return OpenDotaAPI.getLatestMatch(user.steamID).then((matches) => {
      const match = matches[0];
      if (match && match.match_id != user.last_matchID) {
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

function loadPlayers(data) {
  const userPromises = Object.keys(data.users).map((steamID) => {
    return OpenDotaAPI.getPlayer(steamID).then((result) => {
      data.users[steamID] = Object.assign(result, data.users[steamID]);
      return Promise.resolve(data);
    });
  });

  return Promise.all(userPromises).then(() => {
    return Promise.resolve(data);
  });
}

function loadMatches(data) {
  const matchDetails = Object.keys(data.matches).map((matchID) => {
    return OpenDotaAPI.getMatch(matchID).then((match) => {
      data.matches[matchID] = match;
      match.players.forEach((player) => {
        if (player.account_id in data.users) {
          data.users[player.account_id].personaname = player.personaname;
        }
      });
    });
  });

  return Promise.all(matchDetails).then(() => {
    return Promise.resolve(data);
  });
}

function getGameMode(modeID, config) {
  if (modeID === 19 && "event_name" in config) {
    return config.event_name;
  }

  return DotaConstants.gameModes[modeID];
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

    const skill = DotaConstants.skillIDs[match.skill];
    const lobby = DotaConstants.lobbyTypes[match.lobby_type];
    const gameMode = getGameMode(match.game_mode, data.config);
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

    let description = `${user.personaname} ${result} a `;
    if (skill) {
      description += `${skill} skill `;
    }
    if (lobby) {
      description += `${lobby} `;
    }
    description += `${gameMode} match as ${hero.name}`;
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
          // Convert tier to discrete range
          return DotaConstants.rankTierValues.indexOf(rank); // Conv
        })
        .reduce((total, rank) => {
          return (total += rank);
        }, 0);
      const estimatedTierIndex = Math.round(totalTierIndex / rankTiers.length);
      // Convert tier index back into tier rank value
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
            custom_id: `ai:${matchID}:${userID}`,
          },
        ],
      },
    ];

    return Promise.resolve({ embed, components });
  });

  return Promise.all(userPromises)
    .then((embeds) => {
      let promise = Promise.resolve();

      embeds.forEach(({ embed, components }) => {
        promise = promise.then(() => {
          return discord.sendEmbed(embed, "results", components);
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

    return new Promise((resolve, reject) => {
      docClient.update(params, (err, response) => {
        if (err) {
          console.error("DynamoDB.update error:");
          console.error(err);
          console.error(params);
        }

        resolve();
      });
    });
  });

  return Promise.all(userPromises).then(() => {
    return Promise.resolve(data);
  });
}

module.exports = (event, context, callback) => {
  const sharedData = {
    dbUsers: [],
    config: {},
    users: {},
    matches: {},
  };

  loadDBUsers(sharedData)
    .then(loadConfig)
    .then(loadRecentMatches)
    .then(loadPlayers)
    .then(loadMatches)
    .then(sendDiscordMessage)
    .then(updateDB)
    .then(() => {
      callback(null, { message: "Done" });
    });
};
