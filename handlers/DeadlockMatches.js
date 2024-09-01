"use strict";

const AWS = require("aws-sdk");
const cheerio = require("cheerio");

const Discord = require("../Discord");
const utils = require("../utils");

const discord = new Discord();
const docClient = new AWS.DynamoDB.DocumentClient();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

const heroURLs = {
  'abrams': 'https://cdn.wikimg.net/en/deadlockwiki/images/9/99/Bull_card_psd.png',
  'bebop': 'https://cdn.wikimg.net/en/deadlockwiki/images/6/62/Bebop_card_psd.png',
  'dynamo': 'https://cdn.wikimg.net/en/deadlockwiki/images/f/fc/Sumo_card_psd.png',
  'grey talon': 'https://cdn.wikimg.net/en/deadlockwiki/images/5/53/Archer_card_psd.png',
  'haze': 'https://cdn.wikimg.net/en/deadlockwiki/images/7/7b/Haze_card_psd.png',
  'infernus': 'https://cdn.wikimg.net/en/deadlockwiki/images/b/b4/Inferno_card_psd.png',
  'ivy': 'https://cdn.wikimg.net/en/deadlockwiki/images/1/17/Tengu_card_psd.png',
  'kelvin': 'https://cdn.wikimg.net/en/deadlockwiki/images/4/45/Kelvin_card_psd.png',
  'lady geist': 'https://cdn.wikimg.net/en/deadlockwiki/images/6/67/Spectre_card_psd.png',
  'lash': 'https://cdn.wikimg.net/en/deadlockwiki/images/c/c3/Lash_card_psd.png',
  'mcginnis': 'https://cdn.wikimg.net/en/deadlockwiki/images/4/4e/Engineer_card_psd.png',
  'mo & krill': 'https://cdn.wikimg.net/en/deadlockwiki/images/d/d2/Digger_card_psd.png',
  'paradox': 'https://cdn.wikimg.net/en/deadlockwiki/images/4/4a/Chrono_card_psd.png',
  'pocket': 'https://cdn.wikimg.net/en/deadlockwiki/images/4/42/Synth_card_psd.png',
  'seven': 'https://cdn.wikimg.net/en/deadlockwiki/images/1/11/Gigawatt_card_psd.png',
  'shiv': 'https://cdn.wikimg.net/en/deadlockwiki/images/2/29/Shiv_card_psd.png',
  'vindicta': 'https://cdn.wikimg.net/en/deadlockwiki/images/b/b4/Hornet_card_psd.png',
  'viscous': 'https://cdn.wikimg.net/en/deadlockwiki/images/5/5c/Viscous_card_psd.png',
  'warden': 'https://cdn.wikimg.net/en/deadlockwiki/images/b/ba/Warden_card_psd.png',
  'wraith': 'https://cdn.wikimg.net/en/deadlockwiki/images/c/cb/Wraith_card_psd.png',
  'yamato': 'https://cdn.wikimg.net/en/deadlockwiki/images/c/cb/Yamato_card_psd.png',
};

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
      .find("td");

    const rowData = latestMatchRow.map((_, td) => $(td).text()).get();
    if (rowData.length === 0) continue;


    const latestMatchId = rowData[0];

    if (latestMatchId == user.last_match_id) continue;
    const result = (rowData[3] === 'Win') ? 'won' : 'lost';

    const description = `${user.name} ${result} a Deadlock match as ${rowData[1]}`;
    const fields = [];

    if (rowData[4] !== "-") {
      let kda = rowData[4];

      try {
        const [, kills, deaths, assists] = /^(\d+).*?(\d+).*?(\d+)/s.exec(rowData[4]);
        kda = `${kills} / ${deaths} / ${assists}`;
      } catch (e) {
        console.error(e);
      }

      fields.push({
        name: "k / d / a",
        value: kda,
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
        value: Math.round(rowData[7]) || rowData[7],
        inline: true,
      });
    }

    if (rowData[5] !== "-") {
      let value = rowData[5];
      try {
        const duration = parseFloat(rowData[5]);
        const minutes = Math.floor(duration);
        const seconds = Math.floor((duration - minutes) * 60);

        value = `${minutes}m ${seconds}s`;
      } catch (e) {
        // ignore
      }

      fields.push({
        name: "duration",
        value: value,
        inline: true,
      });
    }

    let thumbnail = undefined;
    if (rowData[1].toLowerCase() in heroURLs) {
      thumbnail = {
        url: heroURLs[rowData[1].toLowerCase()],
      };
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
      thumbnail,
    };

    const { discordError } = await discord.sendEmbed(embed, "results");
    if (!discordError) {
      await updateDB(user.player_id, latestMatchId);
    }
  }

  return { message: "Done" };
};
