"use strict";

module.exports = function () {
  let channels = {};
  let userAgent = "";
  let apikey = "";

  function init(data) {
    channels = data.channels;
    userAgent = data.userAgent;
    apikey = data.apikey;
  }

  async function sendEmbed(embed, channel, components) {
    if (!channel) {
      channel = "default";
    }

    if (!(channel in channels)) {
      console.error(`Unknown channel: ${channel}`);
      throw new Error(`Unknown channel: ${channel}`);
    }

    const payload = {
      embeds: [embed],
      allow_mentions: { parse: [] },
    };
    if (components) {
      payload.components = components;
    }

    let response;
    let body;
    let err;
    try {
      response = await fetch(
        `https://discordapp.com/api/channels/${channels[channel]}/messages`,
        {
          method: "POST",
          headers: {
            "User-Agent": userAgent,
            Authorization: `Bot ${apikey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      body = await response.text();
    } catch (fetchError) {
      err = fetchError;
    }

    const hadError = !!err || response.status !== 200;
    if (hadError) {
      console.error("Error sending discord message:");
      console.error({
        embed,
        err,
        statusCode: response?.status,
        body,
      });
    }

    return { error: hadError };
  }

  async function sendInteractionResponse(
    applicationID,
    interactionToken,
    payload,
    update = true,
  ) {
    const baseUrl = `https://discord.com/api/v10/webhooks/${applicationID}/${interactionToken}`;
    const url = update ? `${baseUrl}/messages/@original` : baseUrl;

    const response = await fetch(url, {
      method: update ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("Discord interaction response failed:", {
        status: response.status,
        statusText: response.statusText,
        body,
        url,
      });
    }

    return response;
  }

  this.init = init.bind(this);
  this.sendEmbed = sendEmbed.bind(this);
  this.sendInteractionResponse = sendInteractionResponse.bind(this);
};
