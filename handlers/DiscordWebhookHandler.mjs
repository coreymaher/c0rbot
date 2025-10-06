"use strict";

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});

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
    ["verify"],
  );

  return await crypto.subtle.verify(
    { name: "Ed25519" },
    cryptoKey,
    signature,
    message,
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

  // Parse custom_id: ai:<match_id>:<player_id>, reanalyze:<match_id>:<player_id>
  // or ai_dl:<match_id>:<player_id>, reanalyze_dl:<match_id>:<player_id>
  const parts = interaction.data.custom_id.split(":");
  if (parts.length !== 3) {
    return makeResponse({
      type: 4,
      data: { flags: 64, content: "Malformed action. Try again." },
    });
  }

  const [action, matchId, playerId] = parts;

  // Determine game type and action
  let functionName;
  let isReanalyze;

  if (action === "ai" || action === "reanalyze") {
    // Dota
    functionName = "reddit-dev-dotaAnalyst";
    isReanalyze = action === "reanalyze";
  } else if (action === "ai_dl" || action === "reanalyze_dl") {
    // Deadlock
    functionName = "reddit-dev-deadlockAnalyst";
    isReanalyze = action === "reanalyze_dl";
  } else {
    return makeResponse({
      type: 4,
      data: { flags: 64, content: "Unsupported game type." },
    });
  }

  const userId = interaction.member?.user?.id || interaction.user?.id;

  if (isReanalyze && userId !== environment.discord.adminUserId) {
    return makeResponse({
      type: 4,
      data: {
        flags: 64,
        content: "You don't have permission to reanalyze matches.",
      },
    });
  }

  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: JSON.stringify({
        application_id: interaction.application_id,
        interaction_token: interaction.token,
        guild_id: interaction.guild_id,
        channel_id: interaction.channel_id,
        message_id: interaction.message?.id,
        user_id: userId,
        match_id: matchId,
        player_id: playerId,
        skip_cache: isReanalyze,
      }),
    }),
  );

  return makeResponse({
    type: 5,
    data: {
      flags: 64,
      content: isReanalyze ? "Reanalyzing match..." : "Analyzing match...",
    },
  });
}
