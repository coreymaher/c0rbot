"use strict";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import Discord from "../Discord.js";
import cache from "../cache.mjs";
import OpenAI from "../OpenAI.mjs";
import * as DeadlockConstants from "../DeadlockConstants.mjs";
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
} from "@aws-sdk/client-scheduler";
import crypto from "crypto";

const dbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dbClient);

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
      })
    );
    return result.Item?.name || null;
  } catch (err) {
    console.error(`Failed to get player name from DynamoDB: ${err}`);
    return null;
  }
}

const discord = new Discord();
discord.init(environment.discord);

const scheduler = new SchedulerClient({ region: "us-east-1" });

function createRetryRuleName(match_id, player_id, interaction_token) {
  // Hash the interaction token to keep rule name under 64 chars
  const tokenHash = crypto
    .createHash("md5")
    .update(interaction_token)
    .digest("hex")
    .substring(0, 8);
  return `retry-dl-${match_id}-${player_id}-${tokenHash}`;
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
    const rawMatchData = await fetchMatchData(match_id);
    matchTimer.end();

    if (!rawMatchData?.match_info) {
      if (retryAttempt) {
        // This is already a retry attempt, use existing error message
        await discord.sendInteractionResponse(
          application_id,
          interaction_token,
          {
            flags: 64,
            content: "Match data not available. Try again later.",
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
              "Match data not yet available. Retrying in 2 minutes...",
            allowed_mentions: { parse: [] },
          },
        );
      }

      return;
    }

    const matchData = rawMatchData.match_info;

    const player = matchData.players.find(
      (p) => p.account_id === Number(player_id),
    );

    if (!player) {
      await discord.sendInteractionResponse(
        application_id,
        interaction_token,
        {
          flags: 64,
          content: "Player not found in this match.",
          allowed_mentions: { parse: [] },
        },
      );
      return;
    }

    const playerHero = DeadlockConstants.heroes[player.hero_id]?.name || "Unknown";

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
    const itemsById = await loadItems();
    itemsTimer.end();

    const compactTimer = createTimer("match data processing");
    const compactMatch = generateCompactMatch(matchData, Number(player_id), itemsById);
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

async function loadItems() {
  const cacheKey = "items-v3"; // Increment version when item structure changes

  const cachedItems = await cache.get(cacheNamespace, cacheKey);
  if (cachedItems) {
    return JSON.parse(cachedItems);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url = "https://assets.deadlock-api.com/v2/items";
    const res = await fetch(url, {
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`Failed to fetch items: ${res.status}`);
      return {};
    }

    const itemsArray = await res.json();
    // Create an object keyed by item ID, keeping only fields we use
    const itemsById = itemsArray.reduce((acc, item) => {
      acc[item.id] = {
        id: item.id,
        name: item.name,
        description: item.description,
        hero: item.hero,
        heroes: item.heroes,
        upgrades: item.upgrades,
        item_slot_type: item.item_slot_type,
        is_active_item: item.is_active_item,
        cost: item.cost,
        properties: item.properties ? Object.entries(item.properties).reduce((acc, [key, prop]) => {
          // Only include properties with non-zero, non-empty values
          if (prop?.value && prop.value !== "0" && prop.value !== 0) {
            acc[key] = { value: prop.value };
          }
          return acc;
        }, {}) : undefined,
      };
      return acc;
    }, {});

    const itemsJson = JSON.stringify(itemsById);

    await cache.set(
      cacheNamespace,
      cacheKey,
      itemsJson,
      ONE_DAY,
    );

    return itemsById;
  } catch (err) {
    console.error(`Failed to load items: ${err}`);
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMatchData(matchId) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const url = `https://api.deadlock-api.com/v1/matches/${matchId}/metadata`;
    const res = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`Failed to fetch match data: ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`Failed to fetch match data: ${err}`);
    return null;
  }
}

function stripHtml(text) {
  if (!text) return "";
  return text
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

function formatUpgradeProperties(propertyUpgrades) {
  if (!propertyUpgrades || propertyUpgrades.length === 0) return "";
  return propertyUpgrades
    .map(upgrade => `${upgrade.name}: ${upgrade.bonus}`)
    .join(", ");
}

function preparePlayer(player, focusPlayerId, itemsById, allPlayers) {
  const isFocus = player.account_id === focusPlayerId;
  const heroName = DeadlockConstants.heroes[player.hero_id]?.name || "Unknown";
  const teamName = player.team === 0 ? "amber" : "sapphire";

  const baseStats = {
    focus: isFocus,
    account_id: player.account_id,
    hero: heroName,
    team: teamName,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    net_worth: player.net_worth,
    last_hits: player.last_hits,
    denies: player.denies,
    level: player.level,
    hero_damage: player.hero_damage,
    player_damage: player.player_damage,
  };

  if (!isFocus) return baseStats;

  // Enhanced stats for focus player
  const itemPurchases = [];
  const abilityPurchases = [];
  const abilityLevels = new Map();

  for (const entry of player.items ?? []) {
    const itemData = itemsById[entry.item_id];
    if (!itemData) continue;

    if (itemData.hero || (itemData.heroes && itemData.heroes.length > 0)) {
      // Ability
      const currentLevel = abilityLevels.get(entry.item_id) || 0;
      abilityLevels.set(entry.item_id, currentLevel + 1);

      let description = "";
      if (currentLevel === 0) {
        description = stripHtml(itemData.description?.desc);
      } else {
        const tierKey = `t${currentLevel}_desc`;
        description = stripHtml(itemData.description?.[tierKey]) ||
                     formatUpgradeProperties(itemData.upgrades?.[currentLevel - 1]?.property_upgrades);
      }

      const abilityEntry = {
        game_time_s: entry.game_time_s,
        name: itemData.name || "Unknown",
        level: currentLevel,
        description,
      };

      // Add all non-zero properties
      if (itemData.properties) {
        const props = {};
        for (const [key, prop] of Object.entries(itemData.properties)) {
          if (prop?.value) {
            props[key] = prop.value;
          }
        }
        if (Object.keys(props).length > 0) {
          abilityEntry.properties = props;
        }
      }

      abilityPurchases.push(abilityEntry);
    } else {
      // Item
      const itemEntry = {
        game_time_s: entry.game_time_s,
        sold_at_s: entry.sold_time_s || null,
        name: itemData.name || "Unknown",
        description: stripHtml(itemData.description?.desc),
        slot_type: itemData.item_slot_type,
        is_active: itemData.is_active_item,
        cost: itemData.cost,
      };

      // Add all non-zero properties
      if (itemData.properties) {
        const props = {};
        for (const [key, prop] of Object.entries(itemData.properties)) {
          if (prop?.value) {
            props[key] = prop.value;
          }
        }
        if (Object.keys(props).length > 0) {
          itemEntry.properties = props;
        }
      }

      if (entry.imbued_ability_id) {
        const imbuedAbility = itemsById[entry.imbued_ability_id];
        if (imbuedAbility) {
          itemEntry.imbued_ability = imbuedAbility.name || "Unknown";
        }
      }

      itemPurchases.push(itemEntry);
    }
  }

  // Map death details with killer hero names
  const deathTimeline = player.death_details?.map(death => {
    const deathEntry = {
      game_time_s: death.game_time_s,
      time_to_kill_s: death.time_to_kill_s,
    };

    // Find the killer by player_slot
    if (death.killer_player_slot !== undefined && allPlayers) {
      const killer = allPlayers.find(p => p.player_slot === death.killer_player_slot);
      if (killer?.hero_id) {
        deathEntry.killed_by = DeadlockConstants.heroes[killer.hero_id]?.name || "Unknown";
      }
    }

    return deathEntry;
  }) || [];

  // Build kill timeline from other players' deaths
  const killTimeline = [];
  if (allPlayers) {
    for (const p of allPlayers) {
      for (const death of p.death_details ?? []) {
        if (death.killer_player_slot === player.player_slot) {
          killTimeline.push({
            game_time_s: death.game_time_s,
            victim: DeadlockConstants.heroes[p.hero_id]?.name || "Unknown",
          });
        }
      }
    }
    killTimeline.sort((a, b) => a.game_time_s - b.game_time_s);
  }

  // Include progression stats timeline
  const statsTimeline = player.stats?.map(stat => ({
    time_stamp_s: stat.time_stamp_s,
    net_worth: stat.net_worth,
    level: stat.level,
    creep_kills: stat.creep_kills,
    denies: stat.denies,
    assists: stat.assists,
    shots_hit: stat.shots_hit,
    shots_missed: stat.shots_missed,
    player_damage: stat.player_damage,
    player_damage_taken: stat.player_damage_taken,
    teammate_healing: stat.teammate_healing,
    teammate_barriering: stat.teammate_barriering,
  })) || [];

  return {
    ...baseStats,
    items: itemPurchases,
    abilities: abilityPurchases,
    death_timeline: deathTimeline,
    kill_timeline: killTimeline,
    stats_timeline: statsTimeline,
  };
}

function formatRank(rankValue) {
  if (!rankValue) return "Unranked";

  let tier = Math.floor(rankValue / 10);
  let level = rankValue % 10;

  // Handle edge case: level 0 means previous tier's level 6
  if (level === 0 && tier > 0) {
    tier -= 1;
    level = 6;
  }

  const tierName = DeadlockConstants.ranks[tier];
  return tierName ? `${tierName} ${level}` : "Unknown";
}

function generateCompactMatch(matchData, focusPlayerId, itemsById) {
  const winningTeam = matchData.winning_team === 0 ? "The Amber Hand" : "The Sapphire Flame";

  // Calculate average match rank
  const avgRank = Math.round((matchData.average_badge_team0 + matchData.average_badge_team1) / 2);
  const matchRank = formatRank(avgRank);

  return {
    match_id: matchData.match_id,
    duration_seconds: matchData.match_duration_s,
    winning_team: winningTeam,
    match_rank: matchRank,
    players: matchData.players.map((player) => preparePlayer(player, focusPlayerId, itemsById, matchData.players)),
  };
}

async function analyzeMatch(compactMatch, playerId, playerName) {
  const player = compactMatch.players.find((p) => p.account_id === playerId);
  const heroName = player?.hero || "Unknown";

  const playerIdentifier = playerName
    ? `player ${playerName} (ID: ${playerId})`
    : `player (ID: ${playerId})`;

  const prompt = [
    // Static system prompt (always cached)
    { role: "system", content: SYSTEM_PROMPT.trim() },

    // Dynamic match data and player info (never cached)
    {
      role: "user",
      content: `Analyze this Deadlock match for ${playerIdentifier} playing ${heroName}:\n\n${JSON.stringify(compactMatch)}`,
    },
  ];

  console.log("Compact Match Data:", JSON.stringify(compactMatch, null, 2));

  const response = await OpenAI.chatCompletions(prompt, "gpt-5");

  // Log token usage analytics
  if (response.usage) {
    const usage = response.usage;
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
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

  return JSON.parse(response.choices[0].message.content);
}

const SYSTEM_PROMPT = `
You are a precise, non-speculative Deadlock analyst. Use the supplied match data along with your knowledge of Deadlock.
Write concise, actionable insights about the specified player.
Refer to the player by the provided player name.
Return ONLY one JSON object that matches the schema exactly-no extra keys, no surrounding text or code fences.

CONSTRAINTS
- Use only data explicitly present in JSON; never invent, infer, or speculate on missing values.
- Focus strictly on the specified player account_id; all stats must come from that player's record.
- Round integers to whole numbers; use thousands separators for large numbers.
- Convert time values in seconds into mm:ss format when referencing them (e.g., game_time_s: 125 → "2:05").
- Comparisons only against values in this match (team averages, opponents).

ABILITY UPGRADES
- Abilities show progression with level 0 (base), level 1, level 2, etc.
- Higher level descriptions are additive - they build upon all previous levels.
- A level 2 ability has the effects from level 0, level 1, AND level 2 combined.

ROLE AWARENESS
- Consider the player's performance relative to their team and opponents.
- Frame strengths/weaknesses/recommendations according to match context.

ANALYSIS STANDARDS
- List only meaningful contributions that stand out.
- Avoid trivial accomplishments or raw counts unless impactful.
- When referencing items, analyze timing/impact relative to the match.

RECOMMENDATIONS
- Must align with actual Deadlock gameplay; avoid vague concepts.
- Focus on actionable improvements the player can control.

SUMMARY (<=300 words)
- Focus on player performance with qualitative interpretation, not just raw K/D/A numbers.
- Include match closeness: "closely contested," "moderately one-sided," or "heavily one-sided."
- Include the match rank/skill level in the summary.
- Analyze player's impact across game phases (early, mid, late game) based on match context.

STRENGTHS (1-5 items, <=25 words each)
- Meaningful advantages/successes. Include metrics only if useful.

WEAKNESSES (1-5 items, <=25 words each)
- Significant shortfalls. Omit if no clear weakness.

RECOMMENDATIONS (1-5 items, <=25 words each)
- Actionable by player alone; avoid vague language. At least one should build on a listed strength.

SCHEMA
{
  "summary": string,
  "strengths": string[],
  "weaknesses": string[],
  "recommendations": string[],
}
`;

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
        Description: `Retry analysis for Deadlock match ${match_id} player ${player_id}`,
        Target: {
          Arn: context.invokedFunctionArn,
          RoleArn: context.invokedFunctionArn
            .replace("lambda:us-east-1", "iam:")
            .replace(":function:", ":role/")
            .replace("reddit-dev-deadlockAnalyst", "reddit-dev-scheduler-role"),
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
