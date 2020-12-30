"use strict";

const AWS = require("aws-sdk");
const Discord = require("./Discord");
const PubgAPI = require("./PubgAPI");
const ordinal = require("ordinal");

const environment = JSON.parse(process.env.environment);

const discord = new Discord();
const docClient = new AWS.DynamoDB.DocumentClient();
const pubgAPI = new PubgAPI(environment.pubg);

const request = require("request");

discord.init(environment.discord);

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

      result.Items.forEach((user) => {
        data.users[user.id] = user;
      });

      resolve(data);
    });
  });
}

function loadPlayers(data) {
  const promises = Object.keys(data.users).map((id) => {
    return pubgAPI.getPlayer(id);
  });

  return Promise.all(promises).then((players) => {
    const matches = {};

    players.forEach((player) => {
      if (!("data" in player)) {
        return;
      }

      if (player.data.relationships.matches.data.length > 0) {
        const matchID = player.data.relationships.matches.data[0].id;
        matches[matchID] = true;

        data.users[player.data.id].newest = {
          account_name: player.data.attributes.name,
          matchID,
        };
      }
    });

    data.matches = Object.keys(matches).map((matchID) => {
      return {
        id: matchID,
      };
    });

    return data;
  });
}

function loadMatches(data) {
  const promises = data.matches.map((match) => {
    return pubgAPI.getMatch(match.id);
  });

  return Promise.all(promises).then((matches) => {
    matches.forEach((match) => {
      if (!("data" in match) || !("included" in match)) {
        return;
      }

      const matchTimestamp = Math.floor(
        new Date(match.data.attributes.createdAt).getTime() / 1000
      );

      const messages = [];

      match.included.forEach((obj) => {
        Object.keys(data.users).forEach((userID) => {
          const user = data.users[userID];

          if (user.newest.matchID == match.data.id) {
            user.newest.matchTimestamp = matchTimestamp;
          }

          if (
            obj.type === "participant" &&
            obj.attributes.stats.playerId == userID
          ) {
            if (
              match.data.id != user.last_match_id &&
              matchTimestamp > user.last_match_timestamp
            ) {
              if (
                obj.attributes.stats.winPlace <= 10 ||
                obj.attributes.stats.winPlace == 100
              ) {
                messages.push(
                  buildEmbed(obj.attributes.stats.winPlace, obj, match.data)
                );
              }
            }
          }
        });
      });

      data.messages = messages;
    });

    return data;
  });
}

function buildEmbed(place, player, match) {
  const name = player.attributes.stats.name;

  const matches = match.attributes.gameMode.match(/^(.+?)(-|fpp)/);
  let type = match.attributes.gameMode;
  if (matches && matches.length > 0) {
    type = matches[1];
  }

  if (type == "tequila") {
    type = "Tequila Sunrise";
  }

  let description;
  if (place == 1) {
    description = `${name} just won a ${type} PUBG Chicken Dinner`;
  } else if (place === 100) {
    description = `${name} just threw a ${type} PUBG match`;
  } else {
    description = `${name} just finished ${ordinal(
      place
    )} in a ${type} PUBG match`;
  }

  const killsLabel = type == "solo" ? "kills" : "kills / assists / DBNOs";
  const killsValue =
    type == "solo"
      ? player.attributes.stats.kills
      : `${player.attributes.stats.kills} / ${player.attributes.stats.assists} / ${player.attributes.stats.DBNOs}`;

  const map = match.attributes.mapName.replace(/_(.*)$/, "");
  let distance = 0;
  ["walkDistance", "rideDistance", "swimDistance"].forEach(function (field) {
    distance += player.attributes.stats[field];
  });

  return {
    author: {
      name,
    },
    description,
    fields: [
      { name: killsLabel, value: killsValue, inline: true },
      {
        name: "damage",
        value: `${Math.round(player.attributes.stats.damageDealt)}`,
        inline: true,
      },
      {
        name: "time",
        value: `${Math.round(
          player.attributes.stats.timeSurvived / 60
        )} minutes`,
        inline: true,
      },
      {
        name: "distance",
        value: `${Math.round(distance)} meters`,
        inline: true,
      },
      { name: "map", value: map, inline: true },
    ],
    thumbnail: {
      url:
        "https://theme.zdassets.com/theme_assets/2042105/d3974a8e44860e0e05c0508c5a51f4be724a3439.png",
    },
  };
}

function sendDiscordMessages(data) {
  let promise = Promise.resolve();
  data.messages.forEach((message) => {
    promise = promise.then(() => {
      return discord.sendEmbed(message, "results");
    });
  });

  return promise.then(() => {
    return data;
  });
}

function updateDB(data) {
  const updates = [];

  Object.keys(data.users).forEach((id) => {
    const user = data.users[id];

    let updated = false;
    if ("newest" in user) {
      if (user.newest.account_name != user.account_name) {
        updated = true;
      }

      if (user.newest.matchID != user.last_match_id) {
        updated = true;
      }
    }

    if (!updated) {
      return;
    }

    const params = {
      TableName: process.env.table,
      Key: {
        id,
      },
      UpdateExpression:
        "SET last_match_id = :last_match_id, last_match_timestamp = :last_match_timestamp, account_name = :account_name, updated_at = :updated_at",
      ExpressionAttributeValues: {
        ":last_match_id": user.newest.matchID,
        ":last_match_timestamp": user.newest.matchTimestamp,
        ":account_name": user.newest.account_name,
        ":updated_at": Date.now(),
      },
    };

    const promise = new Promise((resolve, reject) => {
      docClient.update(params, (err, response) => {
        if (err) {
          console.error("DynamoDB.update error:");
          console.error(err);
          console.error(params);
        }

        resolve();
      });
    });

    updates.push(promise);
  });

  return Promise.all(updates).then(() => {
    return Promise.resolve(data);
  });
}

module.exports = (event, context, callback) => {
  const sharedData = {
    users: {},
  };

  loadDBUsers(sharedData)
    .then(loadPlayers)
    .then(loadMatches)
    .then(sendDiscordMessages)
    .then(updateDB)
    .then(() => {
      callback(null, { message: "Done" });
    });
};
