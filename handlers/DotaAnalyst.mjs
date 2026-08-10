// @ts-check

"use strict";

import Discord from "../lib/Discord.mjs";
import cache from "../lib/cache.mjs";
import OpenDotaAPI from "../lib/OpenDotaAPI.mjs";
import LLMClient from "../lib/LLMClient.mjs";
import {
  ANALYSIS_SCHEMA,
  ANALYSIS_MODELS,
  analysisFields,
} from "../lib/analysis.mjs";
import secrets from "../lib/secrets.mjs";
import DotaConstants from "../lib/DotaConstants.mjs";
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

const environment = await secrets();

/** @param {string} operationName */
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

const discord = new Discord(environment.discord);

const scheduler = new SchedulerClient({ region: "us-east-1" });

const openDotaAPI = new OpenDotaAPI(cache);

const llm = new LLMClient({
  openai: environment.openai.apikey,
  anthropic: environment.anthropic.apikey,
  gemini: environment.gemini.apikey,
});

/**
 * @param {string|number} match_id
 * @param {string|number} player_id
 * @param {string} interaction_token
 */
function createRetryRuleName(match_id, player_id, interaction_token) {
  // Hash the interaction token to keep rule name under 64 chars
  const tokenHash = crypto
    .createHash("md5")
    .update(interaction_token)
    .digest("hex")
    .substring(0, 8);
  return `retry-${match_id}-${player_id}-${tokenHash}`;
}

/**
 * @param {any} event the interaction payload relayed by the webhook handler
 * @param {any} context
 */
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
      (/** @type {any} */ player) => player.account_id === Number(player_id),
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

    // Open-ended: components is set below, for admins only.
    /** @type {Record<string, any>} */
    const analysisPayload = {
      flags: 64,
      content: "",
      embeds: [
        {
          title: `Match Analysis - ${playerName} - ${playerHero}`,
          description: analysis.summary,
          fields: analysisFields(analysis),
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
  } catch (rawErr) {
    const err = /** @type {Error} */ (rawErr);
    console.error("DotaAnalyst error:", err);

    let errorMessage =
      "Ran into an issue analyzing this match. Try again later.";

    if (user_id === environment.discord.adminUserId) {
      const errMsg = err.message?.slice(0, 500) || "Unknown error";
      errorMessage = `**Admin Debug Info:**\n\`\`\`\nError: ${errMsg}\nMatch ID: ${match_id}\nPlayer ID: ${player_id}\n\`\`\``;
    }

    await discord.sendInteractionResponse(application_id, interaction_token, {
      flags: 64,
      content: errorMessage,
      allowed_mentions: { parse: [] },
    });

    throw err;
  }
}

/**
 * @param {any} match the compacted match this module builds
 * @param {number} playerId
 * @param {string} playerName
 * @param {any} fullMatch the OpenDota match, unmodelled
 */
async function analyzeMatch(match, playerId, playerName, fullMatch) {
  const promptTimer = createTimer("prompt generation");
  const prompt = await generateAnalysisPrompt(
    match,
    playerId,
    playerName,
    fullMatch,
    {
      cache,
      getHeroItemPopularity:
        openDotaAPI.getHeroItemPopularity.bind(openDotaAPI),
    },
  );
  promptTimer.end();

  console.log("Analyzing Match", { prompt });

  const response = await llm.callWithFallback(
    prompt,
    ANALYSIS_MODELS,
    ANALYSIS_SCHEMA,
  );

  if (response.usage) {
    const usage = response.usage;
    const cachedTokens = usage.cached_tokens;
    console.log("Token usage:", {
      model: response.model,
      total_tokens: usage.total_tokens,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      reasoning_tokens: usage.reasoning_tokens,
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

/**
 * @param {any} eventPayload replayed verbatim as the retry's input
 * @param {any} context
 */
async function scheduleRetryAnalysis(eventPayload, context) {
  const { match_id, player_id, interaction_token } = eventPayload;
  const ruleName = createRetryRuleName(match_id, player_id, interaction_token);
  const scheduleTime = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now

  try {
    await scheduler.send(
      new CreateScheduleCommand({
        Name: ruleName,
        ScheduleExpression: `at(${scheduleTime.toISOString().replace(/\.\d{3}Z$/, "")})`,
        State: "ENABLED",
        Description: `Retry analysis for match ${match_id} player ${player_id}`,
        Target: {
          Arn: context.invokedFunctionArn,
          RoleArn: process.env.SCHEDULER_ROLE_ARN,
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
  } catch (rawErr) {
    const error = /** @type {Error} */ (rawErr);
    console.error(`Failed to schedule retry analysis: ${error.message}`);
    throw error;
  }
}

/**
 * @param {string|number} match_id
 * @param {string|number} player_id
 * @param {string} interaction_token
 */
async function cleanupEventBridgeRule(match_id, player_id, interaction_token) {
  const ruleName = createRetryRuleName(match_id, player_id, interaction_token);

  try {
    await scheduler.send(
      new DeleteScheduleCommand({
        Name: ruleName,
      }),
    );

    console.log(`Cleaned up EventBridge schedule: ${ruleName}`);
  } catch (rawErr) {
    // Don't throw error if schedule doesn't exist
    const error = /** @type {Error} */ (rawErr);
    console.log(`Could not cleanup schedule ${ruleName}: ${error.message}`);
  }
}
