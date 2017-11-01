'use strict';

const AWS = require('aws-sdk');
const request = require('request');
const cheerio = require('cheerio');
const crypto = require('crypto');

const Discord = require('./Discord');

const discord   = new Discord();
const docClient = new AWS.DynamoDB.DocumentClient();

const environment = JSON.parse(process.env.environment);
discord.init(environment.discord);

function loadFeedData(key)
{
    return new Promise((resolve, reject) => {
        const params = {
            TableName: process.env.table,
            Key: { name: key },
        };

        docClient.get(params, (err, data) => {
            if (err) { console.error('DynamoDB.get error:'); console.error(err); console.error(params); }

            resolve(data);
        });
    });
}

function updateFeedData(key, feedData)
{
    return new Promise((resolve, reject) => {
        const params = {
            TableName: process.env.table,
            Item: {
                name: key,
                feed_data: feedData,
                updated_at: Date.now(),
            },
        };

        docClient.put(params, (err) => {
            if (err) { console.error('DynamoDB.put error:'); console.error(err); console.error(params); }

            resolve();
        });
    });
}

function simpleGet(url)
{
    return new Promise((resolve, reject) => {
        request(url, (err, response, body) => {
            if (err) { console.error(`request error ${url}:`); console.error(err); }

            resolve(body);
        });
    });
}

module.exports.redditFeed = (event, context, callback) => {
    const users = [ 'SirBelvedere' ];

    const userPromises = users.map((user) => {
        const key = `reddit-${user}`;

        const dbPromise = loadFeedData(key);
        const rssPromise = simpleGet(`https://www.reddit.com/user/${user}/submitted/.rss`);

        return Promise.all([ dbPromise, rssPromise ])
            .then((values) => {
                const db  = values[0];
                const rss = values[1];

                const $ = cheerio.load(rss);

                const entry = $('entry').first();
                const id = entry.find('id').text();
                const title = entry.find('title').text();
                const link = entry.find('link');

                if (!id || !title) {
                    console.error('cheerio parse error');
                    console.error(rss);
                    return resolve();
                }

                return new Promise((resolve, reject) => {
                    if (!('Item' in db) || db.Item.feed_data != id) {
                        const embed = {
                            title: 'There is a new Dota 2 reddit patch post',
                            description: title,
                            url: link.attr('href'),
                            thumbnail: {
                                url: 'https://b.thumbs.redditmedia.com/F82n9T2HtoYxNmxbe1CL0RKxBdeUEw-HVyd-F-Lb91o.png',
                            },
                        };
                        const discordPromise = discord.sendEmbed(embed, 'updates');
                        const writePromise = updateFeedData(key, id);

                        Promise.all([ discordPromise, writePromise ]).then(() => { resolve(); });
                    } else {
                        resolve();
                    }
                });
            })
        ;
    });

    Promise.all(userPromises).then(() => {
        callback(null, { message: 'Done' });
    });
};

module.exports.dotaBlog = (event, context, callback) => {
    const dbPromise = loadFeedData('dota2_blog');
    const rssPromise = simpleGet('http://blog.dota2.com/feed/');

    Promise.all([ dbPromise, rssPromise ]).then((values) => {
        const db  = values[0];
        const rss = values[1];

        const $ = cheerio.load(rss);

        const item = $('item').first();
        const id = item.find('guid').text();
        const title = item.find('title').text();
        const link = item.find('comments').text().replace('/#comments', '');

        if (!id || !title) {
            console.error('cheerio parse error');
            console.error(rss);
            return Promise.resolve();
        }

        new Promise((resolve, reject) => {
            if (!('Item' in db) || db.Item.feed_data != id) {
                const embed = {
                    title: 'There is a new Dota 2 blog post',
                    description: title,
                    url: link,
                    thumbnail: {
                        url: 'http://vignette3.wikia.nocookie.net/defenseoftheancients/images/6/64/Dota_2_Logo_only.png/revision/latest',
                    },
                };
                const discordPromise = discord.sendEmbed(embed, 'updates');
                const writePromise = updateFeedData('dota2_blog', id);

                Promise.all([ discordPromise, writePromise ]).then(() => { resolve(); });
            } else {
                return resolve();
            }
        });
    }).then(() => {
        callback(null, { message: 'Done' });
    });
}

module.exports.pokemongoUpdates = (event, context, callback) => {
    const url = 'http://pokemongo.nianticlabs.com/en/post/';

    const dbPromise = loadFeedData('pokemon-go_updates');
    const requestPromise = simpleGet(url);

    Promise.all([ dbPromise, requestPromise ]).then((values) => {
        const db      = values[0];
        const content = values[1];

        const $ = cheerio.load(content);

        const list = $('.post-list');

        const post = list.find('.post-list__title').first();
        const title = post.text().trim();
        const link = post.find('a');
        const id = (link.length > 0) ? link.attr('href') : crypto.createHash('md5').update(title).digest('hex');
        const urlLink = (link.length > 0) ? `http://pokemongo.nianticlabs.com${link.attr('href')}` : url;

        new Promise((resolve, reject) => {
            if (!('Item' in db) || db.Item.feed_data != id) {
                const embed = {
                    title: 'There is a new Pokemon Go Update',
                    description: title,
                    url: urlLink,
                    thumbnail: {
                        url: 'http://pokemongolive.com/img/global/pgo_logo.png',
                    },
                };
                const discordPromise = discord.sendEmbed(embed, 'updates');
                const writePromise = updateFeedData('pokemon-go_updates', id);

                Promise.all([ discordPromise, writePromise ]).then(() => { resolve(); });
            } else {
                return resolve();
            }
        });
    }).then(() => {
        callback(null, { message: 'Done' });
    });
};

module.exports.twitchStreams = (event, context, callback) => {
    const environment = JSON.parse(process.env.environment);

    const channels = [ 'purgegamers' ];

    const promises = channels.map((channel) => {
        const key = `twitch-${channel}`;
        const dbPromise = loadFeedData(key);
        const requestPromise = simpleGet(`https://api.twitch.tv/kraken/streams/${channel}?client_id=${environment.twitch.apikey}`);

        Promise.all([ dbPromise, requestPromise ]).then((values) => {
            const db       = values[0];
            const response = JSON.parse(values[1]);

            if (response.stream && (!('Item' in db) || db.Item.feed_data != response.stream._id)) {
                const embed = {
                    title: `${response.stream.channel.display_name} just went live on Twitch`,
                    description: response.stream.channel.status,
                    url: response.stream.channel.url,
                    thumbnail: {
                        url: response.stream.channel.logo,
                    },
                };
                const discordPromise = discord.sendEmbed(embed, 'updates');
                const writePromise = updateFeedData(key, response.stream._id);

                return Promise.all([ discordPromise, writePromise ]);
            } else {
                return Promise.resolve();
            }
        });
    });

    Promise.all(promises).then(() => {
        callback(null, { message: 'Done' });
    });
};

module.exports.arkChangelog = (event, context, callback) => {
    const dbPromise = loadFeedData('ark-changelog');
    const requestPromise = simpleGet('https://survivetheark.com/index.php?/forums/forum/5-changelog-patch-notes/');

    function parseVersion(content)
    {
        const $ = cheerio.load(content);
        const link = $('a[title^="PC Patch Notes"]');
        const matches = /PC Patch Notes.*?Current.*?\((.*?)\)/i.exec(link.text());

        return (matches.length > 1) ? { version: matches[1], url: link.attr('href') } : null;
    }

    Promise.all([ dbPromise, requestPromise ]).then((values) => {
        const db       = values[0];
        const response = values[1];

        const version = parseVersion(response);
        if (version && (!('Item' in db) || db.Item.feed_data != version.version)) {
            return simpleGet(version.url).then((response) => {
                const $ = cheerio.load(response);

                const post = $('.cPost').first();
                const content = post.text().trim();
                const matches = (new RegExp('Current Version: ' + version.version + '\\s*\\n\\s*([^]*?)v[\\d.]+\\n', 'im')).exec(content);

                if (matches.length) {
                    const changes = matches[1].replace(/[\t ]+\*/g, '*');
                    const embed = {
                        title: 'There is a new ARK update',
                        description: version.version,
                        url: version.url,
                        thumbnail: {
                            url: 'https://pbs.twimg.com/profile_images/749126245372334080/iIfI182O_400x400.jpg',
                        },
                        fields: [
                            { name: 'Changes', value: changes },
                        ],
                    };
                    const discordPromise = discord.sendEmbed(embed, 'updates');
                    const writePromise = updateFeedData('ark-changelog', version.version);

                    return Promise.all([ discordPromise, writePromise ]);
                } else {
                    return Promise.resolve();
                }
            });
        } else {
            return Promise.resolve();
        }
    }).then(() => {
        callback(null, { message: 'Done' });
    });
};

module.exports.dotaMatches = require('./DotaMatches');
module.exports.openDotaMatches = require('./OpenDotaMatches');

module.exports.dotaUpdates = (event, context, callback) => {
    const dbPromise = loadFeedData('dota2_updates');
    const requestPromise = simpleGet('http://www.dota2.com/news/updates/');

    Promise.all([ dbPromise, requestPromise ]).then((values) => {
        const db  = values[0];
        const content = values[1];

        const $ = cheerio.load(content);

        const linkTest = /\.com\/news\/updates\/[^\/]+\/?/;
        const latestLink = $('a')
            .filter((i, el) => {
                const link = $(el);

                return (linkTest.test(link.attr('href')));
            })
            .first()
        ;

        if (!latestLink || !latestLink.attr('href') || !latestLink.text()) {
            console.error('cheerio parse error');
            console.error(content);
            return Promise.resolve();
        }

        new Promise((resolve, reject) => {
            const url = latestLink.attr('href');
            if (!('Item' in db) || db.Item.feed_data != url) {
                const embed = {
                    title: 'There is a new Dota 2 update',
                    description: latestLink.text(),
                    url: url,
                    thumbnail: {
                        url: 'http://vignette3.wikia.nocookie.net/defenseoftheancients/images/6/64/Dota_2_Logo_only.png/revision/latest',
                    },
                };
                const discordPromise = discord.sendEmbed(embed, 'updates');
                const writePromise = updateFeedData('dota2_updates', url);

                Promise.all([ discordPromise, writePromise ]).then(() => { resolve(); });
            } else {
                return resolve();
            }
        });
    }).then(() => {
        callback(null, { message: 'Done' });
    });
}

module.exports.steamUpdates = (event, context, callback) => {
    const games = [
        {
            url: 'http://store.steampowered.com/news/?appids=322330',
            name: "Don't Starve Together",
            key: 'dont-starve-together_updates',
            thumbnail: 'https://vignette.wikia.nocookie.net/dont-starve-game/images/9/90/Don%27t_Starve_Together_Logo.png',
        },
        {
            url: 'http://store.steampowered.com/news/?appids=578080',
            name: "PLAYERUNKNOWN'S BATTLEGROUNDS",
            key: 'pubg_updates',
            thumbnail: 'http://cdn.edgecast.steamstatic.com/steam/apps/578080/header.jpg',
        },
    ];

    const gamePromises = games.map((game) => {
        const dbPromise = loadFeedData(game.key);
        const requestPromise = simpleGet(game.url);

        return Promise.all([ dbPromise, requestPromise ]).then((values) => {
            const db  = values[0];
            const content = values[1];

            const $ = cheerio.load(content);

            const idTest = /^post_(\d+)$/;
            const posts = $('div[id]')
                .filter((i, el) => {
                    const post = $(el);

                    return (idTest.test(post.attr('id')));
                })
                .filter((i, el) => {
                    const post = $(el);

                    return (post.find('a').length);
                })
            ;

            if (!posts.length) {
                console.error('cheerio parse error');
                console.error(content);
                return Promise.resolve();
            }

            const latestPost = posts.first();

            const link = latestPost.find('a').first();
            const matches = idTest.exec(latestPost.attr('id'));
            const postID = matches[1];

            if (!('Item' in db) || db.Item.feed_data != postID) {
                const embed = {
                    title: `There is a new ${game.name} update`,
                    description: link.text(),
                    url: link.attr('href'),
                    thumbnail: {
                        url: game.thumbnail,
                    },
                };
                const discordPromise = discord.sendEmbed(embed, 'updates');
                const writePromise = updateFeedData(game.key, postID);

                return Promise.all([ discordPromise, writePromise ]);
            } else {
                return Promise.resolve();
            }
        });
    });

    Promise.all(gamePromises).then(() => {
        callback(null, { message: 'Done' });
    });
}

module.exports.dontStarveChangelog = (event, context, callback) => {
    const dbPromise = loadFeedData('dont-starve-together_changelog');
    const requestPromise = simpleGet('http://forums.kleientertainment.com/game-updates/dst/?page=1');

    Promise.all([ dbPromise, requestPromise ]).then((values) => {
        const db  = values[0];
        const content = values[1];

        const $ = cheerio.load(content);

        const linkTest = /\.com\/news\/updates\/[^\/]+\/?/;
        const latestLink = $('a[data-releaseid]')
            .filter((i, el) => {
                const link = $(el);

                return (linkTest.test(link.attr('href')));
            })
            .first()
        ;

        if (!latestLink) {
            console.error('cheerio parse error');
            console.error(content);
            return Promise.resolve();
        }

        new Promise((resolve, reject) => {
            const url = latestLink.attr('href');
            if (!('Item' in db) || db.Item.feed_data != url) {
                const embed = {
                    title: "There is a new Don't Starve Together update",
                    description: latestLink.text(),
                    url: url,
                    thumbnail: {
                        url: 'https://vignette.wikia.nocookie.net/dont-starve-game/images/9/90/Don%27t_Starve_Together_Logo.png',
                    },
                };
                const discordPromise = discord.sendEmbed(embed, 'updates');
                const writePromise = updateFeedData('dont-starve-together_changelog', url);

                Promise.all([ discordPromise, writePromise ]).then(() => { resolve(); });
            } else {
                return resolve();
            }
        });
    }).then(() => {
        callback(null, { message: 'Done' });
    });
}