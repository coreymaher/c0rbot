'use strict';

const request = require('request');
const querystring = require('querystring');

const DELAY = 6000;

module.exports = function(options) {
    const apikey = options.apikey;

    const requests = [];
    let lastRequest = null;
    let isLoading = false;

    function getRequest(url, params) {
        const promise = new Promise((resolve, reject) => {
            requests.push({
                promise: {
                    resolve,
                    reject,
                },
                request: {
                    url: `${url}?${querystring.stringify(params)}`,
                    headers: {
                        'Authorization': `Bearer ${apikey}`,
                        'Accept': 'application/vnd.api+json',
                    },
                },
            });
        });

        runRequestQueue();

        return promise;
    }

    function getPlayer(id) {
        return getRequest(`https://api.playbattlegrounds.com/shards/pc-na/players/${id}`);
    }

    function getMatch(id) {
        return getRequest(`https://api.playbattlegrounds.com/shards/pc-na/matches/${id}`);
    }

    function runRequestQueue() {
        if (!isLoading && requests.length > 0) {
            doNextRequest();
        }
    }

    function doNextRequest() {
        const nextRequest = requests.shift();

        if (request) {
            const curTime = (Date.now() / 1000);
            let delay = 0;

            if (lastRequest) {
                const validRequestTime = (lastRequest + DELAY);
                if (curTime < validRequestTime) {
                    delay = (validRequestTime - curTime);
                }
            }

            isLoading = true;
            setTimeout(function() {
                request(nextRequest.request, (err, response, body) => {
                    if (err) {
                        console.error(`request error ${nextRequest.request.url}:`);
                        console.error(err);

                        nextRequest.promise.reject();
                    } else {
                        nextRequest.promise.resolve(JSON.parse(body));
                    }

                    lastRequest = (Date.now() / 1000);
                    isLoading = false;
                    runRequestQueue();
                });
            }, delay);
        }
    }

    this.getPlayer = getPlayer.bind(this);
    this.getMatch = getMatch.bind(this);
}
