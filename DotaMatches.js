'use strict';

const AWS       = require('aws-sdk');
const BigNumber = require('big-number');
const Discord   = require('./Discord');
const DotaAPI   = require('./DotaAPI');

const environment = JSON.parse(process.env.environment);

const discord   = new Discord();
const docClient = new AWS.DynamoDB.DocumentClient();
const dotaAPI   = new DotaAPI(environment.dota);

discord.init(environment.discord);

const lobbyTypes = {
    '-1': "Invalid",
    0 : "Unranked",
    1 : "Practice",
    2 : "Tournament",
    3 : "Tutorial",
    //4 : "Co-Op with Bots",
    4 : "Siltbreaker",
    5 : "Ranked Team MM",
    6 : "Solo MM",
    7 : "Ranked",
    8 : "1v1 Mid",
};

const gameModes = {
    '-1': "Invalid",
    0 : "None",
    1 : "All Pick",
    2 : "Captain's Mode",
    3 : "Random Draft",
    4 : "Single Draft",
    5 : "All Random",
    6 : "Intro",
    7 : "Diretide",
    8 : "Reverse Captain's Mode",
    9 : "The Greeviling",
    10: "Tutorial",
    11: "Mid Only",
    12: "Least Played",
    13: "New Player Pool",
    14: "Compendium Matchmaking",
    15: "Custom",
    16: "Captains Draft",
    17: "Balanced Draft",
    18: "Ability Draft",
    19: "Event",
    20: "All Random Death Match",
    21: "1v1 Solo Mid",
    22: "All Pick",
};

const skillIDs = {
    0: "",
    1: "Normal",
    2: "High",
    3: "Very High",
};

const heroes = {
    1: {
        name: "Anti-Mage",
        image: 'antimage',
    },
    2: {
        name: "Axe",
        image: "axe",
    },
    3: {
        name: "Bane",
        image: "bane",
    },
    4: {
        name: "Bloodseeker",
        image: "bloodseeker",
    },
    5: {
        name: "Crystal Maiden",
        image: "crystal_maiden",
    },
    6: {
        name: "Drow Ranger",
        image: "drow_ranger",
    },
    7: {
        name: "Earthshaker",
        image: "earthshaker",
    },
    8: {
        name: "Juggernaut",
        image: "juggernaut",
    },
    9: {
        name: "Mirana",
        image: "mirana",
    },
    11: {
        name: "Shadow Fiend",
        image: "nevermore",
    },
    10: {
        name: "Morphling",
        image: "morphling",
    },
    12: {
        name: "Phantom Lancer",
        image: "phantom_lancer",
    },
    13: {
        name: "Puck",
        image: "puck",
    },
    14: {
        name: "Pudge",
        image: "pudge",
    },
    15: {
        name: "Razor",
        image: "razor",
    },
    16: {
        name: "Sand King",
        image: "sand_king",
    },
    17: {
        name: "Storm Spirit",
        image: "storm_spirit",
    },
    18: {
        name: "Sven",
        image: "sven",
    },
    19: {
        name: "Tiny",
        image: "tiny",
    },
    20: {
        name: "Vengeful Spirit",
        image: "vengefulspirit",
    },
    21: {
        name: "Windranger",
        image: "windrunner",
    },
    22: {
        name: "Zeus",
        image: "zuus",
    },
    23: {
        name: "Kunkka",
        image: "kunkka",
    },
    25: {
        name: "Lina",
        image: "lina",
    },
    31: {
        name: "Lich",
        image: "lich",
    },
    26: {
        name: "Lion",
        image: "lion",
    },
    27: {
        name: "Shadow Shaman",
        image: "shadow_shaman",
    },
    28: {
        name: "Slardar",
        image: "slardar",
    },
    29: {
        name: "Tidehunter",
        image: "tidehunter",
    },
    30: {
        name: "Witch Doctor",
        image: "witch_doctor",
    },
    32: {
        name: "Riki",
        image: "riki",
    },
    33: {
        name: "Enigma",
        image: "enigma",
    },
    34: {
        name: "Tinker",
        image: "tinker",
    },
    35: {
        name: "Sniper",
        image: "sniper",
    },
    36: {
        name: "Necrophos",
        image: "necrolyte",
    },
    37: {
        name: "Warlock",
        image: "warlock",
    },
    38: {
        name: "Beastmaster",
        image: "beastmaster",
    },
    39: {
        name: "Queen of Pain",
        image: "queenofpain",
    },
    40: {
        name: "Venomancer",
        image: "venomancer",
    },
    41: {
        name: "Faceless Void",
        image: "faceless_void",
    },
    42: {
        name: "Wraith King",
        image: "skeleton_king",
    },
    43: {
        name: "Death Prophet",
        image: "death_prophet",
    },
    44: {
        name: "Phantom Assassin",
        image: "phantom_assassin",
    },
    45: {
        name: "Pugna",
        image: "pugna",
    },
    46: {
        name: "Templar Assassin",
        image: "templar_assassin",
    },
    47: {
        name: "Viper",
        image: "viper",
    },
    48: {
        name: "Luna",
        image: "luna",
    },
    49: {
        name: "Dragon Knight",
        image: "dragon_knight",
    },
    50: {
        name: "Dazzle",
        image: "dazzle",
    },
    51: {
        name: "Clockwerk",
        image: "rattletrap",
    },
    52: {
        name: "Leshrac",
        image: "leshrac",
    },
    53: {
        name: "Nature's Prophet",
        image: "furion",
    },
    54: {
        name: "Lifestealer",
        image: "life_stealer",
    },
    55: {
        name: "Dark Seer",
        image: "dark_seer",
    },
    56: {
        name: "Clinkz",
        image: "clinkz",
    },
    57: {
        name: "Omniknight",
        image: "omniknight",
    },
    58: {
        name: "Enchantress",
        image: "enchantress",
    },
    59: {
        name: "Huskar",
        image: "huskar",
    },
    60: {
        name: "Night Stalker",
        image: "night_stalker",
    },
    61: {
        name: "Broodmother",
        image: "broodmother",
    },
    62: {
        name: "Bounty Hunter",
        image: "bounty_hunter",
    },
    63: {
        name: "Weaver",
        image: "weaver",
    },
    64: {
        name: "Jakiro",
        image: "jakiro",
    },
    65: {
        name: "Batrider",
        image: "batrider",
    },
    66: {
        name: "Chen",
        image: "chen",
    },
    67: {
        name: "Spectre",
        image: "spectre",
    },
    69: {
        name: "Doom",
        image: "doom_bringer",
    },
    68: {
        name: "Ancient Apparition",
        image: "ancient_apparition",
    },
    70: {
        name: "Ursa",
        image: "ursa",
    },
    71: {
        name: "Spirit Breaker",
        image: "spirit_breaker",
    },
    72: {
        name: "Gyrocopter",
        image: "gyrocopter",
    },
    73: {
        name: "Alchemist",
        image: "alchemist",
    },
    74: {
        name: "Invoker",
        image: "invoker",
    },
    75: {
        name: "Silencer",
        image: "silencer",
    },
    76: {
        name: "Outworld Devourer",
        image: "obsidian_destroyer",
    },
    77: {
        name: "Lycan",
        image: "lycan",
    },
    78: {
        name: "Brewmaster",
        image: "brewmaster",
    },
    79: {
        name: "Shadow Demon",
        image: "shadow_demon",
    },
    80: {
        name: "Lone Druid",
        image: "lone_druid",
    },
    81: {
        name: "Chaos Knight",
        image: "chaos_knight",
    },
    82: {
        name: "Meepo",
        image: "meepo",
    },
    83: {
        name: "Treant Protector",
        image: "treant",
    },
    84: {
        name: "Ogre Magi",
        image: "ogre_magi",
    },
    85: {
        name: "Undying",
        image: "undying",
    },
    86: {
        name: "Rubick",
        image: "rubick",
    },
    87: {
        name: "Disruptor",
        image: "disruptor",
    },
    88: {
        name: "Nyx Assassin",
        image: "nyx_assassin",
    },
    89: {
        name: "Naga Siren",
        image: "naga_siren",
    },
    90: {
        name: "Keeper of the Light",
        image: "keeper_of_the_light",
    },
    91: {
        name: "Io",
        image: "wisp",
    },
    92: {
        name: "Visage",
        image: "visage",
    },
    93: {
        name: "Slark",
        image: "slark",
    },
    94: {
        name: "Medusa",
        image: "medusa",
    },
    95: {
        name: "Troll Warlord",
        image: "troll_warlord",
    },
    96: {
        name: "Centaur Warrunner",
        image: "centaur",
    },
    97: {
        name: "Magnus",
        image: "magnataur",
    },
    98: {
        name: "Timbersaw",
        image: "shredder",
    },
    99: {
        name: "Bristleback",
        image: "bristleback",
    },
    100: {
        name: "Tusk",
        image: "tusk",
    },
    101: {
        name: "Skywrath Mage",
        image: "skywrath_mage",
    },
    102: {
        name: "Abaddon",
        image: "abaddon",
    },
    103: {
        name: "Elder Titan",
        image: "elder_titan",
    },
    104: {
        name: "Legion Commander",
        image: "legion_commander",
    },
    106: {
        name: "Ember Spirit",
        image: "ember_spirit",
    },
    107: {
        name: "Earth Spirit",
        image: "earth_spirit",
    },
    108: {
        name: "Underlord",
        image: "abyssal_underlord",
    },
    109: {
        name: "Terrorblade",
        image: "terrorblade",
    },
    110: {
        name: "Phoenix",
        image: "phoenix",
    },
    105: {
        name: "Techies",
        image: "techies",
    },
    111: {
        name: "Oracle",
        image: "oracle",
    },
    112: {
        name: "Winter Wyvern",
        image: "winter_wyvern",
    },
    113: {
        name: "Arc Warden",
        image: "arc_warden",
    },
    114: {
        name: "Monkey King",
        image: "monkey_king",
    },
};

function formatNumber(number)
{
    return (number >= 1000) ? ((number / 1000).toFixed(1) + 'k') : number;
}

function loadDBUsers(data)
{
    return new Promise((resolve, reject) => {
        const scanParams = {
            TableName: process.env.table,
        };

        docClient.scan(scanParams, (err, result) => {
            if (err) { console.error('DynamoDB.get error:'); console.error(err); console.error(scanParams); }

            data.dbUsers = result.Items;

            resolve(data);
        });
    });
}

function loadRecentMatches(data)
{
    const userPromises = data.dbUsers.map((user) => {
        return dotaAPI.getLatestMatch(user.steamID)
            .then((response) => {
                const match = response.result.matches[0];
                if (match.match_id != user.last_matchID) {
                    data.matches[match.match_id] = {};
                    data.users[user.steamID] = {
                        matchID: match.match_id,
                    };
                }

                return Promise.resolve();
            })
        ;
    });

    return Promise.all(userPromises).then(() => { return Promise.resolve(data); });
}

function loadUsers(data)
{
    const accountIDs = Object.keys(data.users).map((accountID) => { return (new BigNumber('76561197960265728')).plus(accountID).toString(); });

    if (!accountIDs) {
        return Promise.resolve(data);
    }

    return dotaAPI.getPlayerSummaries(accountIDs)
        .then((result) => {
            result.response.players.forEach((player) => {
                const accountID = (new BigNumber(player.steamid)).minus('76561197960265728').toString();

                data.users[accountID] = Object.assign(player, data.users[accountID]);
            });

            return Promise.resolve(data);
        })
    ;
}

function loadMatches(data)
{
    const matchDetails = Object.keys(data.matches).map((matchID) => {
        return dotaAPI.getMatchDetails(matchID)
            .then((response) => {
                data.matches[matchID] = response.result;
            })
        ;
    });

    return Promise.all(matchDetails).then(() => { return Promise.resolve(data); });
}

function loadMatchSkill(data)
{
    const matchSkill = Object.keys(data.matches).map((matchID) => {
        const heroIDs = data.matches[matchID].players.map((player) => { return player.hero_id; });
        return dotaAPI.getMatchSkill(matchID, heroIDs)
            .then((skillID) => {
                data.matches[matchID].skillID = skillID;
            })
        ;
    });

    return Promise.all(matchSkill).then(() => { return Promise.resolve(data); });
}

function sendDiscordMessage(data)
{
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

        const skill = skillIDs[match.skillID];
        const lobby = lobbyTypes[match.lobby_type];
        const gameMode = gameModes[match.game_mode];
        const hero = heroes[dotaPlayer.hero_id];
        const heroName = hero.name;
        const playerName = user.personaname;
        const isRadiant = (dotaPlayer.player_slot < 128);
        const team = (isRadiant) ? 'radiant' : 'dire';
        const result = (match.radiant_win == isRadiant) ? 'won' : 'lost';
        const kills = dotaPlayer.kills;
        const deaths = dotaPlayer.deaths;
        const assists = dotaPlayer.assists;
        const gpm = dotaPlayer.gold_per_min;
        const xpm = dotaPlayer.xp_per_min;
        const heroDamage  = formatNumber(dotaPlayer.hero_damage);
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
                { name: 'k / d / a', value: `${kills} / ${deaths} / ${assists}`, inline: true },
                { name: 'gpm / xpm', value: `${gpm} / ${xpm}`, inline: true },
                { name: 'hd / td / hh', value: `${heroDamage} / ${towerDamage} / ${heroHealing}`, inline: true },
                { name: 'more', value: `[dotabuff](https://www.dotabuff.com/matches/${matchID}) | [opendota](https://opendota.com/matches/${matchID})` },
            ],
            thumbnail: {
                url: thumbnail_url,
            },
        };

        return Promise.resolve(embed);
    });

    return Promise.all(userPromises).then((embeds) => {
        let promise = Promise.resolve();

        embeds.forEach((embed) => {
            promise = promise.then(() => { return discord.sendEmbed(embed); });
        });

        return promise;
    }).then(() => { return Promise.resolve(data); });
}

function updateDB(data)
{
    const userPromises = Object.keys(data.users).map((userID) => {
        const user = data.users[userID];

        const params = {
            TableName: process.env.table,
            Key: {
                steamID: userID,
            },
            UpdateExpression: 'SET last_matchID = :last_matchID, updated_at = :updated_at',
            ExpressionAttributeValues: {
                ':last_matchID': user.matchID,
                ':updated_at': Date.now(),
            },
        };

        return new Promise((resolve, reject) => {
            docClient.update(params, (err, response) => {
                if (err) { console.error('DynamoDB.update error:'); console.error(err); console.error(params); }

                resolve();
            });
        });
    });

    return Promise.all(userPromises).then(() => { return Promise.resolve(data); });
}

module.exports = (event, context, callback) => {
    const data = {
        dbUsers: [],
        users: {},
        matches: {},
    };

    loadDBUsers({
        dbUsers: [],
        users: {},
        matches: {},
    })
        .then(loadRecentMatches)
        .then(loadUsers)
        .then(loadMatches)
        .then(loadMatchSkill)
        .then(sendDiscordMessage)
        .then(updateDB)
        .then(() => {
            callback(null, { message: 'Done' });
        })
    ;
};
