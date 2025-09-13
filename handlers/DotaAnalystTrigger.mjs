"use strict";

import AWS from "aws-sdk";

const lambda = new AWS.Lambda();

const environment = JSON.parse(process.env.environment);

const hexToBytes = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
const publicKey = hexToBytes(environment.discord.publicKey);

export async function verifyDiscordRequest({ rawBody, headers }) {
  const sig = headers["x-signature-ed25519"] || headers["X-Signature-Ed25519"];
  const ts =
    headers["x-signature-timestamp"] || headers["X-Signature-Timestamp"];
  if (!sig || !ts) return false;

  const signature = hexToBytes(sig);
  const message = new TextEncoder().encode(ts + rawBody);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    publicKey,
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  return await crypto.subtle.verify(
    { name: "Ed25519" },
    cryptoKey,
    signature,
    message
  );
}

function makeResponse(payload, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export async function handler(event) {
  console.log({ event });

  const rawBody =
    typeof event.body === "string"
      ? event.body
      : JSON.stringify(event.body || "");

  const validRequest = await verifyDiscordRequest({
    rawBody,
    headers: event.headers || {},
  });
  if (!validRequest) {
    return { statusCode: 401, body: "invalid request signature" };
  }

  const interaction = JSON.parse(rawBody);

  if (interaction.type === 1) {
    return makeResponse({ type: 1 });
  }

  if (
    interaction.type !== 3 ||
    !interaction.data ||
    !interaction.data.custom_id
  ) {
    return makeResponse({
      type: 4,
      data: { flags: 64, content: "Unsupported interaction." },
    });
  }

  // Parse custom_id: ai:<match_id>:<player_id>
  const parts = interaction.data.custom_id.split(":");
  if (parts.length !== 3 || parts[0] !== "ai") {
    return makeResponse({
      type: 4,
      data: { flags: 64, content: "Malformed action. Try again." },
    });
  }
  const [_, matchId, playerId] = parts;

  await lambda
    .invoke({
      FunctionName: "reddit-dev-dotaAnalyst",
      InvocationType: "Event",
      Payload: JSON.stringify({
        application_id: interaction.application_id,
        interaction_token: interaction.token,
        guild_id: interaction.guild_id,
        channel_id: interaction.channel_id,
        message_id: interaction.message?.id,
        user_id: interaction.member?.user?.id || interaction.user?.id,
        match_id: matchId,
        player_id: playerId,
      }),
    })
    .promise();

  return makeResponse({
    type: 5,
    data: {
      flags: 64,
      content: "Analyzing match...",
    },
  });
}
