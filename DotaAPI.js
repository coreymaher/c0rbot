'use strict';

const request = require('request');
const querystring = require('querystring');

module.exports = function(options)
{
    const apikey = options.apikey;

    function getRequest(url, params)
    {
        params = (params) ? params : {};
        params.key = apikey;

        const requestUrl = `${url}?${querystring.stringify(params)}`;

        return new Promise((resolve, reject) => {
            request(requestUrl, (err, response, body) => {
                if (err) { console.error(`request error ${url}:`); console.error(err); }
                resolve(JSON.parse(body));
            });
        });
    }

    function getLatestMatch(steamID)
    {
        return getRequest('http://api.steampowered.com/IDOTA2Match_570/GetMatchHistory/V001/', {
                account_id: steamID,
                matches_requested: 1,
        });
    }

    function getPlayerSummaries(accountIDs)
    {
        return getRequest('http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/', {
            steamids: accountIDs.join(','),
        });
    }

    function getMatchDetails(matchID)
    {
        return getRequest('http://api.steampowered.com/IDOTA2Match_570/GetMatchDetails/V001/', {
            match_id: matchID,
        });
    }

    function getMatchSkill(matchID, heroIDs)
    {
        return new Promise((resolve, reject) => {
            let promise = Promise.resolve();

            let found = false;
            [ 1, 2, 3 ].forEach((skillID) => {
                heroIDs.forEach((heroID) => {
                    promise = promise.then(() => {
                        if (found) {
                            return Promise.resolve();
                        }

                        return getRequest('http://api.steampowered.com/IDOTA2Match_570/GetMatchHistory/V001/', {
                                start_at_match_id: matchID,
                                skill: skillID,
                                min_players: 10,
                                hero_id: heroID,
                                matches_requested: 1,
                        }).then((result) => {
                            if (result.result.num_results && result.result.matches[0].match_id == matchID) {
                                resolve(skillID);
                                found = true;
                            }

                            return Promise.resolve();
                        });
                    });
                });
            });

            promise.then(() => {
                resolve(0);
            });
        });
    }

    this.getLatestMatch = getLatestMatch.bind(this);
    this.getPlayerSummaries = getPlayerSummaries.bind(this);
    this.getMatchDetails = getMatchDetails.bind(this);
    this.getMatchSkill = getMatchSkill.bind(this);
}
