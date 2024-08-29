"use strict";

const AWS = require("aws-sdk");
const cheerio = require("cheerio");

const Discord = require("../Discord");
const utils = require("../utils");

const discord = new Discord();
const docClient = new AWS.DynamoDB.DocumentClient();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

const scanParams = {
  TableName: "matches",
  FilterExpression: "game = :s",
  ExpressionAttributeValues: {
    ":s": "deadlock",
  },
}

async function loadDBUsers() {
  try {
    const data = await docClient.scan(scanParams).promise();
    return data.Items;
  } catch (ex) {
    console.error(`DynamoDB.get error: ${ex}`)
  }

  return [];
}

async function updateDB(playerID, lastMatchID) {
  const params = {
    TableName: 'matches',
    Key: {
      player_id: playerID,
      game: 'deadlock',
    },
    UpdateExpression:
      'SET last_match_id = :last_match_id, updated_at = :updated_at',
    ExpressionAttributeValues: {
      ':last_match_id': lastMatchID,
      ':updated_at': Date.now(),
    },
  };


  try {
    await docClient.update(params).promise();
  } catch (ex) {
    console.error(`DynamoDB.update error: ${ex}`);
  }
}

module.exports.handler = async () => {
  const users = await loadDBUsers();

  for (const user of users) {
    const content = await utils.simpleGet(`https://tracklock.gg/players/${user.player_id}`);
    const $ = cheerio.load(content);

    /* Current row order:
     * 0 - Match Id
     * 1 - Hero
     * 2 - Date
     * 3 - Result
     * 4 - K/D/A
     * 5 - Duration
     * 6 - Last Hits
     * 7 - Souls Per Minute (SPM)
     */

    const latestMatchRow = $('th:contains("Match Id")')
      .first()
      .closest("table")
      .find("tbody tr")
      .first()
      .find("td")

    const rowData = latestMatchRow.map((_, td) => $(td).text()).get();
    if (rowData.length === 0) continue;


    const latestMatchId = rowData[0];

    if (latestMatchId == user.last_match_id) continue;
    const result = (rowData[3] === 'Win') ? 'won' : 'lost';

    const description = `${user.name} ${result} a Deadlock match as ${rowData[1]}`;
    const fields = [];

    if (rowData[4] !== "-") {
      fields.push({
        name: "k / d / a",
        value: rowData[4],
        inline: true,
      });
    }

    if (rowData[6] !== "-") {
      fields.push({
        name: "last hits",
        value: rowData[6],
        inline: true,
      });
    }

    if (rowData[7] !== "-") {
      fields.push({
        name: "souls per minute",
        value: rowData[7],
        inline: true,
      });
    }

    if (rowData[5] !== "-") {
      fields.push({
        name: "duration",
        value: rowData[5],
        inline: true,
      });
    }

    fields.push({
      name: "more",
      value: `[tracklock](https://tracklock.gg/matches/${latestMatchId})`,
    })

    const embed = {
      author: {
        name: user.name,
        icon_url: user.avatar || undefined,
      },
      description,
      fields,
      // thumbnail: {
      //   url: thumbnail_url,
      // },
    };

    await discord.sendEmbed(embed, "results");
    await updateDB(user.player_id, latestMatchId);
  }

  return { message: "Done" };
};
