"use strict";

const request = require("request");

module.exports = function () {
  let channels = {};
  let userAgent = "";
  let apikey = "";

  function init(data) {
    channels = data.channels;
    userAgent = data.userAgent;
    apikey = data.apikey;
  }

  function sendMessage(message, channel) {
    return new Promise((resolve, reject) => {
      if (!message) {
        message = "";
      }
      if (!channel) {
        channel = "default";
      }

      if (!(channel in channels)) {
        console.error(`Unknown channel: ${channel}`);
        return reject();
      }

      request.post(
        {
          url: `https://discordapp.com/api/channels/${channels[channel]}/messages`,
          headers: {
            "User-Agent": userAgent,
            Authorization: `Bot ${apikey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: message,
          }),
        },
        function (err, response, body) {
          resolve();
        }
      );
    });
  }

  function sendEmbed(embed, channel, components) {
    return new Promise((resolve, reject) => {
      if (!channel) {
        channel = "default";
      }

      if (!(channel in channels)) {
        console.error(`Unknown channel: ${channel}`);
        return reject();
      }

      const payload = {
        embeds: [embed],
        allow_mentions: { parse: [] },
      };
      if (components) {
        payload.components = components;
      }

      request.post(
        {
          url: `https://discordapp.com/api/channels/${channels[channel]}/messages`,
          headers: {
            "User-Agent": userAgent,
            Authorization: `Bot ${apikey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        function (err, response, body) {
          const hadError = !!err || response.statusCode !== 200;
          if (hadError) {
            console.error("Error sending discord message:");
            console.error({
              embed,
              err,
              statusCode: response?.statusCode,
              body,
            });
          }

          resolve({ error: hadError });
        }
      );
    });
  }

  async function sendInteractionResponse(
    applicationID,
    interactionToken,
    payload,
    update = true
  ) {
    const baseUrl = `https://discord.com/api/v10/webhooks/${applicationID}/${interactionToken}`;
    const url = update ? `${baseUrl}/messages/@original` : baseUrl;

    return await fetch(url, {
      method: update ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  this.init = init.bind(this);
  this.sendMessage = sendMessage.bind(this);
  this.sendEmbed = sendEmbed.bind(this);
  this.sendInteractionResponse = sendInteractionResponse.bind(this);
};
