"use strict";

const AWS = require("aws-sdk");
const Discord = require("./Discord");
const FortniteAPI = require("./FortniteAPI");

const environment = JSON.parse(process.env.environment);

const discord = new Discord();
const docClient = new AWS.DynamoDB.DocumentClient();
const fortniteAPI = new FortniteAPI(environment.fortnite);

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
        if ("stats" in user) {
          user.stats = JSON.parse(user.stats);
        }
        data.users[user.name] = user;
      });

      resolve(data);
    });
  });
}

function parseStat(stat) {
  const results = {
    kills: stat ? stat.kills.valueInt : 0,
    score: stat ? stat.score.valueInt : 0,
    matches: stat ? stat.matches.valueInt : 0,
    top: {},
  };

  if (stat) {
    Object.keys(stat).forEach((name) => {
      const matches = name.match(/^top(\d+)$/);
      if (matches) {
        results.top[matches[1]] = stat[name].valueInt;
      }
    });
  }

  return results;
}

function loadStats(data) {
  const users = Object.keys(data.users);

  if (!users) {
    return Promise.resolve(data);
  }

  const promises = users.map((name) => {
    return fortniteAPI.getStats(name).then((apiData) => {
      const stats = apiData.stats;
      data.users[name].newStats = {
        solo: parseStat(stats.p2),
        duo: parseStat(stats.p10),
        squad: parseStat(stats.p9),
      };
    });
  });

  return Promise.all(promises).then(() => {
    return data;
  });
}

function buildEmbed({ name, kills, result, type }) {
  return {
    author: {
      name,
    },
    description: `${name} finished top ${result} in a ${type} Fortnite match with ${kills} kills`,
    thumbnail: {
      url:
        "https://ih0.redbubble.net/image.505938377.2392/flat,1000x1000,075,f.u5.jpg",
    },
  };
}

function sendDiscordMessage(data) {
  const messages = [];

  Object.keys(data.users).map((name) => {
    const user = data.users[name];
    user.updated = false;

    if (user.stats) {
      ["solo", "duo", "squad"].forEach((type) => {
        if (
          type in user.stats &&
          user.newStats[type].matches > user.stats[type].matches
        ) {
          user.updated = true;

          Object.keys(user.stats[type].top).forEach((result) => {
            if (result > 10) {
              return;
            }

            if (
              user.newStats[type].top[result] > user.stats[type].top[result]
            ) {
              messages.push(
                buildEmbed({
                  name: user.name,
                  kills: user.newStats[type].kills - user.stats[type].kills,
                  result,
                  type,
                })
              );
            }
          });
        }
      });
    } else {
      user.updated = true;
    }

    return messages;
  });

  let promise = Promise.resolve();
  messages.forEach((message) => {
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

  Object.keys(data.users).forEach((name) => {
    const user = data.users[name];

    if (!user.updated) {
      return;
    }

    const params = {
      TableName: process.env.table,
      Key: {
        name,
      },
      UpdateExpression: "SET stats = :stats, updated_at = :updated_at",
      ExpressionAttributeValues: {
        ":stats": JSON.stringify(user.newStats),
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
    .then(loadStats)
    .then(sendDiscordMessage)
    .then(updateDB)
    .then(() => {
      callback(null, { message: "Done" });
    });
};
