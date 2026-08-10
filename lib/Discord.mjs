// @ts-check

export default class Discord {
  #channels;
  #userAgent;
  #apikey;

  /**
   * @param {object} options
   * @param {Record<string, string>} options.channels name to Discord channel id
   * @param {string} options.userAgent
   * @param {string} options.apikey
   */
  constructor({ channels, userAgent, apikey }) {
    this.#channels = channels;
    this.#userAgent = userAgent;
    this.#apikey = apikey;
  }

  /**
   * @param {Record<string, any>} embed a Discord embed, built by the caller
   * @param {string} [channel] a key of `channels`, defaulting to "default"
   * @param {any[]} [components]
   * @returns {Promise<{error: boolean}>}
   */
  async sendEmbed(embed, channel, components) {
    if (!channel) {
      channel = "default";
    }

    if (!(channel in this.#channels)) {
      console.error(`Unknown channel: ${channel}`);
      throw new Error(`Unknown channel: ${channel}`);
    }

    // Open-ended: components is set after construction.
    /** @type {Record<string, any>} */
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
        `https://discordapp.com/api/channels/${this.#channels[channel]}/messages`,
        {
          method: "POST",
          headers: {
            "User-Agent": this.#userAgent,
            Authorization: `Bot ${this.#apikey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      body = await response.text();
    } catch (fetchError) {
      err = fetchError;
    }

    const hadError = !!err || response?.status !== 200;
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

  /**
   * @param {string} applicationID
   * @param {string} interactionToken
   * @param {Record<string, any>} payload
   * @param {boolean} [update] PATCH the deferred reply rather than POST a new one
   */
  async sendInteractionResponse(
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
}
