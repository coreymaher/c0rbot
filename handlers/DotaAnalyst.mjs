"use strict";

import Discord from "../lib/Discord.js";
import cache from "../lib/cache.mjs";
import OpenDotaAPI from "../lib/OpenDotaAPI.mjs";
import LLMClient from "../lib/LLMClient.mjs";
import DotaConstants from "../lib/DotaConstants.js";
import {
  processPopularItems,
  generateCompactMatch,
  generateAnalysisPrompt,
} from "../lib/DotaMatchProcessor.mjs";
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
} from "@aws-sdk/client-scheduler";
import crypto from "crypto";

const cacheNamespace = "dota-ai-analyzer";

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

const discord = new Discord();
discord.init(environment.discord);

const scheduler = new SchedulerClient({ region: "us-east-1" });

// Instantiate OpenDotaAPI with cache
const openDotaAPI = new OpenDotaAPI(cache);

const llm = new LLMClient({
  openai: environment.openai.apikey,
  anthropic: environment.anthropic.apikey,
  gemini: environment.gemini.apikey,
});

function createRetryRuleName(match_id, player_id, interaction_token) {
  // Hash the interaction token to keep rule name under 64 chars
  const tokenHash = crypto
    .createHash("md5")
    .update(interaction_token)
    .digest("hex")
    .substring(0, 8);
  return `retry-${match_id}-${player_id}-${tokenHash}`;
}

export async function handler(event, context) {
  const {
    application_id,
    interaction_token,
    match_id,
    player_id,
    skip_cache,
    user_id,
    retryAttempt = false,
  } = event;

  try {
    // Clean up EventBridge rule if this is a retry attempt
    if (retryAttempt) {
      console.log(`Retry attempt for match ${match_id}`);
      await cleanupEventBridgeRule(match_id, player_id, interaction_token);
    }
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
                  custom_id: `reanalyze:${match_id}:${player_id}`,
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
    const matchTimer = createTimer("OpenDota match fetch");
    const fullMatch = await openDotaAPI.getMatch(match_id);
    matchTimer.end();
    if (!fullMatch.od_data.has_parsed) {
      const parseTimer = createTimer("OpenDota parse request");
      await openDotaAPI.requestParse(match_id);
      parseTimer.end();

      if (retryAttempt) {
        // This is already a retry attempt, use existing error message
        await discord.sendInteractionResponse(
          application_id,
          interaction_token,
          {
            flags: 64,
            content: "Match has not been parsed by OpenDota. Try again later.",
            allowed_mentions: { parse: [] },
          },
        );
      } else {
        // First attempt, schedule a retry
        await scheduleRetryAnalysis(
          {
            application_id,
            interaction_token,
            match_id,
            player_id,
            skip_cache: true,
            user_id,
            retryAttempt: true,
          },
          context,
        );

        await discord.sendInteractionResponse(
          application_id,
          interaction_token,
          {
            flags: 64,
            content:
              "Match has not been parsed by OpenDota. Retrying in 2 minutes...",
            allowed_mentions: { parse: [] },
          },
        );
      }

      return;
    }

    const compactTimer = createTimer("match data processing");
    const match = await generateCompactMatch(fullMatch, Number(player_id));
    compactTimer.end();

    const player = fullMatch.players.find(
      (player) => player.account_id === Number(player_id),
    );
    const playerHero = DotaConstants.heroes[player.hero_id].name;
    const playerName = player.personaname;

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

    const analysisTimer = createTimer("AI analysis");
    const analysis = await analyzeMatch(
      match,
      Number(player_id),
      playerName,
      fullMatch,
    );
    analysisTimer.end();

    const analysisPayload = {
      flags: 64,
      content: "",
      embeds: [
        {
          title: `Match Analysis - ${playerName} - ${playerHero}`,
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
              custom_id: `reanalyze:${match_id}:${player_id}`,
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
    console.error("DotaAnalyst error:", err);

    let errorMessage =
      "Ran into an issue analyzing this match. Try again later.";

    // Provide detailed error info for admin users
    if (user_id === environment.discord.adminUserId) {
      const truncatedMessage = err.message.slice(0, 500);
      const truncatedStack = err.stack.slice(0, 800);
      errorMessage = `**Admin Debug Info:**\n\`\`\`\nError: ${truncatedMessage}\nStack: ${truncatedStack}\nMatch ID: ${match_id}\nPlayer ID: ${player_id}\n\`\`\``;
    }

    await discord.sendInteractionResponse(application_id, interaction_token, {
      flags: 64,
      content: errorMessage,
      allowed_mentions: { parse: [] },
    });

    throw err;
  }
}

// All business logic has been extracted to ../lib/DotaMatchProcessor.mjs

async function analyzeMatch(match, playerId, playerName, fullMatch) {
  const promptTimer = createTimer("prompt generation");
  const prompt = await generateAnalysisPrompt(match, playerId, playerName, fullMatch, {
    cache,
    getHeroItemPopularity: openDotaAPI.getHeroItemPopularity.bind(openDotaAPI),
  });
  promptTimer.end();

  console.log("Analyzing Match", { prompt });

  const response = await llm.call(prompt, "gemini-2.5-flash");

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

async function scheduleRetryAnalysis(eventPayload, context) {
  const { match_id, player_id, interaction_token } = eventPayload;
  const ruleName = createRetryRuleName(match_id, player_id, interaction_token);
  const scheduleTime = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now

  try {
    // Create the EventBridge Scheduler schedule
    await scheduler.send(
      new CreateScheduleCommand({
        Name: ruleName,
        ScheduleExpression: `at(${scheduleTime.toISOString().replace(/\.\d{3}Z$/, "")})`,
        State: "ENABLED",
        Description: `Retry analysis for match ${match_id} player ${player_id}`,
        Target: {
          Arn: context.invokedFunctionArn,
          RoleArn: context.invokedFunctionArn
            .replace("lambda:us-east-1", "iam:")
            .replace(":function:", ":role/")
            .replace("reddit-dev-dotaAnalyst", "reddit-dev-scheduler-role"),
          Input: JSON.stringify(eventPayload),
        },
        FlexibleTimeWindow: {
          Mode: "OFF",
        },
      }),
    );

    console.log(
      `Created EventBridge schedule: ${ruleName} scheduled for ${scheduleTime.toISOString()}`,
    );
  } catch (error) {
    console.error(`Failed to schedule retry analysis: ${error.message}`);
    throw error;
  }
}

async function cleanupEventBridgeRule(match_id, player_id, interaction_token) {
  const ruleName = createRetryRuleName(match_id, player_id, interaction_token);

  try {
    await scheduler.send(
      new DeleteScheduleCommand({
        Name: ruleName,
      }),
    );

    console.log(`Cleaned up EventBridge schedule: ${ruleName}`);
  } catch (error) {
    // Don't throw error if schedule doesn't exist
    console.log(`Could not cleanup schedule ${ruleName}: ${error.message}`);
  }
}
