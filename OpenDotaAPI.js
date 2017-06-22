'use strict';

const request = require('request');
const querystring = require('querystring');

function API()
{
    const prefix = 'https://api.opendota.com/api/';
    function getRequest(url, params)
    {
        params = (params) ? params : {};

        const requestUrl = `${prefix}${url}?${querystring.stringify(params)}`;

        return new Promise((resolve, reject) => {
            request(requestUrl, (err, response, body) => {
                if (err) { console.error(`request error ${url}:`); console.error(err); }
                resolve(JSON.parse(body));
            });
        });
    }

    function getMatch(matchID)
    {
        return getRequest(`matches/${matchID}`);
    }

    function getLatestMatch(steamID)
    {
        return getRequest(`players/${steamID}/matches`, {
            limit: 1,
            significant: 0,
        });
    }

    function getPlayer(steamID)
    {
        return getRequest(`players/${steamID}`);
    }

    this.getMatch = getMatch.bind(this);
    this.getLatestMatch = getLatestMatch.bind(this);
    this.getPlayer = getPlayer.bind(this);
}

module.exports = new API();
