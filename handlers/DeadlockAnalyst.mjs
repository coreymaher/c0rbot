"use strict";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import Discord from "../lib/Discord.js";
import cache from "../lib/cache.mjs";
import LLMClient from "../lib/LLMClient.mjs";
import * as DeadlockConstants from "../lib/DeadlockConstants.mjs";
import DeadlockAPI from "../lib/DeadlockAPI.mjs";
import {
  loadItems,
  generateCompactMatch,
  generateAnalysisPrompt,
} from "../lib/DeadlockMatchProcessor.mjs";

const dbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dbClient);

// Instantiate DeadlockAPI with cache
const deadlockAPI = new DeadlockAPI(cache);

const cacheNamespace = "deadlock-ai-analyzer";
const ONE_DAY = 24 * 60 * 60;

const environment = JSON.parse(process.env.environment);

function createTimer(operationName) {
  const start = Date.now();
  console.log(`Starting ${operationName}...`);
  return {
    end: () => {
      const duration = Date.now() - start;
      console.log(`${operationName} completed: ${duration}ms`);
    },
  };
}

async function getPlayerName(player_id) {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: "matches",
        Key: {
          player_id: String(player_id),
          game: "deadlock",
        },
      }),
    );
    return result.Item?.name || null;
  } catch (err) {
    console.error(`Failed to get player name from DynamoDB: ${err}`);
    return null;
  }
}

const discord = new Discord();
discord.init(environment.discord);

const llm = new LLMClient({
  openai: environment.openai.apikey,
  anthropic: environment.anthropic.apikey,
  gemini: environment.gemini.apikey,
});

export async function handler(event, context) {
  const {
    application_id,
    interaction_token,
    match_id,
    player_id,
    skip_cache,
    user_id,
  } = event;

  try {
    const cacheKey = `match:${match_id}:player:${player_id}`;
    if (!skip_cache) {
      const cacheTimer = createTimer("cache lookup");
      const cachedAnalysis = await cache.get(cacheNamespace, cacheKey);
      cacheTimer.end();
      if (cachedAnalysis) {
        const payload = JSON.parse(cachedAnalysis);

        // Add reanalyze button to cached response if user is admin
        if (user_id === environment.discord.adminUserId) {
          payload.components = [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 2,
                  label: "Reanalyze",
                  custom_id: `reanalyze_dl:${match_id}:${player_id}`,
                },
              ],
            },
          ];
        }

        await discord.sendInteractionResponse(
          application_id,
          interaction_token,
          payload,
        );
        return;
      }
    }

    await discord.sendInteractionResponse(
      application_id,
      interaction_token,
      {
        flags: 64,
        content: "Loading match...",
        allowed_mentions: { parse: [] },
      },
      true,
    );

    const matchTimer = createTimer("Deadlock API match fetch");
    const rawMatchData = await deadlockAPI.getMatchMetadata(match_id);
    matchTimer.end();

    if (!rawMatchData?.match_info) {
      await discord.sendInteractionResponse(application_id, interaction_token, {
        flags: 64,
        content: "Match data not available. Try again later.",
        allowed_mentions: { parse: [] },
      });
      return;
    }

    const matchData = rawMatchData.match_info;

    const player = matchData.players.find(
      (p) => p.account_id === Number(player_id),
    );

    if (!player) {
      await discord.sendInteractionResponse(application_id, interaction_token, {
        flags: 64,
        content: "Player not found in this match.",
        allowed_mentions: { parse: [] },
      });
      return;
    }

    const playerHero =
      DeadlockConstants.heroes[player.hero_id]?.name || "Unknown";

    const nameTimer = createTimer("player name lookup");
    const playerName = await getPlayerName(player_id);
    nameTimer.end();

    await discord.sendInteractionResponse(
      application_id,
      interaction_token,
      {
        flags: 64,
        content: "Analyzing match...",
        allowed_mentions: { parse: [] },
      },
      true,
    );

    const itemsTimer = createTimer("items data loading");
    const itemsData = await loadItems({ cache });
    itemsTimer.end();

    const compactTimer = createTimer("match data processing");
    const compactMatch = generateCompactMatch(
      matchData,
      Number(player_id),
      itemsData,
    );
    compactTimer.end();

    const analysisTimer = createTimer("AI analysis");
    const analysis = await analyzeMatch(
      compactMatch,
      Number(player_id),
      playerName,
    );
    analysisTimer.end();

    const analysisPayload = {
      flags: 64,
      content: "",
      embeds: [
        {
          title: playerName
            ? `Match Analysis - ${playerName} - ${playerHero}`
            : `Match Analysis - ${playerHero}`,
          description: analysis.summary,
          fields: [
            {
              name: "Highlights",
              value: analysis.strengths.map((txt) => `- ${txt}`).join("\n"),
            },
            {
              name: "Focus areas",
              value: analysis.weaknesses.map((txt) => `- ${txt}`).join("\n"),
            },
            {
              name: "Recommendations",
              value: analysis.recommendations
                .map((txt) => `- ${txt}`)
                .join("\n"),
            },
          ],
        },
      ],
      allowed_mentions: { parse: [] },
    };

    if (user_id === environment.discord.adminUserId) {
      analysisPayload.components = [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              label: "Reanalyze",
              custom_id: `reanalyze_dl:${match_id}:${player_id}`,
            },
          ],
        },
      ];
    }

    await discord.sendInteractionResponse(
      application_id,
      interaction_token,
      analysisPayload,
    );

    const cacheSetTimer = createTimer("cache set");
    await cache.set(cacheNamespace, cacheKey, JSON.stringify(analysisPayload));
    cacheSetTimer.end();
  } catch (err) {
    console.error("DeadlockAnalyst error:", err);

    let errorMessage =
      "Ran into an issue analyzing this match. Try again later.";

    // Provide detailed error info for admin users
    if (user_id === environment.discord.adminUserId) {
      errorMessage = `**Admin Debug Info:**\n\`\`\`\nError: ${err.message}\nStack: ${err.stack}\nMatch ID: ${match_id}\nPlayer ID: ${player_id}\n\`\`\``;
    }

    await discord.sendInteractionResponse(application_id, interaction_token, {
      flags: 64,
      content: errorMessage,
      allowed_mentions: { parse: [] },
    });

    throw err;
  }
}

// All business logic has been extracted to ../lib/DeadlockMatchProcessor.mjs

async function analyzeMatch(compactMatch, playerId, playerName) {
  const prompt = generateAnalysisPrompt(compactMatch, playerId, playerName);

  console.log("Compact Match Data:", JSON.stringify(compactMatch, null, 2));

  const response = await llm.call(prompt, "gemini-2.5-pro");

  // Log token usage analytics
  if (response.usage) {
    const usage = response.usage;
    const cachedTokens = usage.cached_tokens;
    console.log("Token usage:", {
      total_tokens: usage.total_tokens,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      cached_tokens: cachedTokens,
      cache_hit_rate:
        cachedTokens > 0
          ? `${((cachedTokens / usage.prompt_tokens) * 100).toFixed(1)}%`
          : "0%",
      uncached_tokens: usage.prompt_tokens - cachedTokens,
    });
  }

  return response.output;
}
