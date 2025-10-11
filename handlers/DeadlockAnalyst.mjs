"use strict";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import Discord from "../Discord.js";
import cache from "../cache.mjs";
import OpenAI from "../OpenAI.mjs";
import * as DeadlockConstants from "../DeadlockConstants.mjs";
import DeadlockAPI from "../DeadlockAPI.mjs";
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
    const rawMatchData = await DeadlockAPI.getMatchMetadata(match_id);
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
    const itemsById = await loadItems();
    itemsTimer.end();

    const compactTimer = createTimer("match data processing");
    const compactMatch = generateCompactMatch(
      matchData,
      Number(player_id),
      itemsById,
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
        properties: item.properties
          ? Object.entries(item.properties).reduce((acc, [key, prop]) => {
              // Only include properties with non-zero, non-empty values
              if (prop?.value && prop.value !== "0" && prop.value !== 0) {
                acc[key] = { value: prop.value };
              }
              return acc;
            }, {})
          : undefined,
      };
      return acc;
    }, {});

    const itemsJson = JSON.stringify(itemsById);

    await cache.set(cacheNamespace, cacheKey, itemsJson, ONE_DAY);

    return itemsById;
  } catch (err) {
    console.error(`Failed to load items: ${err}`);
    return {};
  } finally {
    clearTimeout(timeout);
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
    .map((upgrade) => `${upgrade.name}: ${upgrade.bonus}`)
    .join(", ");
}

function preparePlayer(
  player,
  focusPlayerId,
  itemsById,
  allPlayers,
  customStatsLookup,
  matchData,
  teamfights,
) {
  const isFocus = player.account_id === focusPlayerId;
  const heroName = DeadlockConstants.heroes[player.hero_id]?.name || "Unknown";

  // Extract time series stats - detailed for focus player, basic for others
  const statsTimeline =
    player.stats?.map((stat) => {
      const timelineEntry = {
        time_stamp_s: stat.time_stamp_s,
        net_worth: stat.net_worth,
        player_damage: stat.player_damage,
        player_damage_taken: stat.player_damage_taken,
        deaths: stat.deaths,
        ...(isFocus && {
          level: stat.level,
          creep_kills: stat.creep_kills,
          denies: stat.denies,
          assists: stat.assists,
          shots_hit: stat.shots_hit,
          shots_missed: stat.shots_missed,
          teammate_healing: stat.teammate_healing,
          teammate_barriering: stat.teammate_barriering,
        }),
      };

      // Add custom stats from the stats entry
      if (stat.custom_user_stats && customStatsLookup) {
        // Map of custom stat names to output field names
        const customStatMapping = {
          "Enemy Hero Accuracy##Immobile Hits": "immobile_hits",
          "Bullet Stats##StunHitRate": "stun_hit_rate",
          ...(isFocus && {
            "Bullet Stats##HeroHitRate": "hero_hit_rate",
            "Parry Miss": "parry_miss",
            "Parry Success": "parry_success",
            "PowerUp Permanent": "powerup_permanent",
          }),
        };

        for (const customStat of stat.custom_user_stats) {
          const statName = customStatsLookup[customStat.id];
          const fieldName = customStatMapping[statName];
          if (fieldName) {
            timelineEntry[fieldName] = customStat.value;
          }
        }
      }

      return timelineEntry;
    }) || [];

  // Get final powerup count from last stats entry
  let powerupPermanent = 0;
  if (player.stats && player.stats.length > 0 && customStatsLookup) {
    const lastStat = player.stats[player.stats.length - 1];
    if (lastStat.custom_user_stats) {
      const powerupStat = lastStat.custom_user_stats.find(
        (cs) => customStatsLookup[cs.id] === "PowerUp Permanent"
      );
      if (powerupStat) {
        powerupPermanent = powerupStat.value;
      }
    }
  }

  // Calculate total death duration
  const totalDeathDuration = player.death_details
    ? player.death_details.reduce((sum, death) => sum + (death.death_duration_s || 0), 0)
    : 0;

  const baseStats = {
    focus: isFocus,
    hero: heroName,
    team: player.team,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    net_worth: player.net_worth,
    last_hits: player.last_hits,
    denies: player.denies,
    level: player.level,
    hero_damage: player.hero_damage,
    player_damage: player.player_damage,
    powerup_permanent: powerupPermanent,
    total_death_duration_s: totalDeathDuration,
    stats_timeline: statsTimeline,
  };

  if (!isFocus) return baseStats;

  // Enhanced stats for focus player
  const itemPurchases = [];
  const abilityPurchases = [];
  const abilityLevels = new Map();

  // Map of property names to values that should be excluded
  const excludeDefaults = {
    ChannelMoveSpeed: ["-1"],
    AbilityUnitTargetLimit: ["1"],
    AbilityResourceCost: ["0"],
    AbilityCastDelay: ["0"],
  };

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
        description =
          stripHtml(itemData.description?.[tierKey]) ||
          formatUpgradeProperties(
            itemData.upgrades?.[currentLevel - 1]?.property_upgrades,
          );
      }

      const abilityEntry = {
        game_time_s: entry.game_time_s,
        name: itemData.name || "Unknown",
        level: currentLevel,
        description,
      };

      // Add meaningful properties, excluding default/meaningless values
      if (itemData.properties) {
        const props = {};
        for (const [key, prop] of Object.entries(itemData.properties)) {
          const value = prop?.value;
          if (!value) continue;

          // Check if this property has excluded default values
          const excludedValues = excludeDefaults[key];
          if (excludedValues && excludedValues.includes(String(value)))
            continue;

          props[key] = value;
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

      // Add meaningful properties, excluding default/meaningless values
      if (itemData.properties) {
        const props = {};
        for (const [key, prop] of Object.entries(itemData.properties)) {
          const value = prop?.value;
          if (!value) continue;

          // Check if this property has excluded default values
          const excludedValues = excludeDefaults[key];
          if (excludedValues && excludedValues.includes(String(value)))
            continue;

          props[key] = value;
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

  // Calculate teamfight participation for focus player
  let teamfightStats = null;
  if (isFocus && teamfights && teamfights.length > 0) {
    const playerSlot = player.player_slot;
    const playerTeam = player.team;
    const playerHero = DeadlockConstants.heroes[player.hero_id]?.name || "Unknown";
    const participated = [];

    // Get focus player's position data for proximity checking
    const focusPlayerPath = matchData.match_paths?.paths?.find(
      (p) => p.player_slot === playerSlot
    );

    for (const fight of teamfights) {
      // Check if player participated (died or got a kill)
      const died = fight.participants.includes(playerSlot);

      // Count kills in this fight by checking if this player killed enemies during the fight window
      let kills = 0;
      for (const p of allPlayers) {
        if (p.team === playerTeam) continue; // Skip teammates

        for (const death of p.death_details ?? []) {
          if (
            death.killer_player_slot === playerSlot &&
            death.game_time_s >= fight.start_time_s &&
            death.game_time_s <= fight.start_time_s + fight.duration_s
          ) {
            kills++;
          }
        }
      }

      // Check if player was nearby any death in this fight (even if they didn't get kills or die)
      let wasNearby = false;
      if (focusPlayerPath && !died && kills === 0 && matchData.match_paths) {
        // Only check proximity if they didn't already participate via kills/deaths
        const PROXIMITY_THRESHOLD = 1000; // Approx 50-100m, enough to catch ranged support/abilities

        for (const p of allPlayers) {
          for (const death of p.death_details ?? []) {
            // Check if this death is part of this teamfight
            if (
              death.game_time_s >= fight.start_time_s &&
              death.game_time_s <= fight.start_time_s + fight.duration_s
            ) {
              // Get focus player's position at this death time
              const deathTimeIdx = Math.floor(death.game_time_s);
              if (deathTimeIdx >= 0 && deathTimeIdx < focusPlayerPath.x_pos.length && deathTimeIdx < focusPlayerPath.y_pos.length) {
                // Decompress position
                const xNormalized = focusPlayerPath.x_pos[deathTimeIdx] / matchData.match_paths.x_resolution;
                const yNormalized = focusPlayerPath.y_pos[deathTimeIdx] / matchData.match_paths.y_resolution;
                const focusX = focusPlayerPath.x_min + xNormalized * (focusPlayerPath.x_max - focusPlayerPath.x_min);
                const focusY = focusPlayerPath.y_min + yNormalized * (focusPlayerPath.y_max - focusPlayerPath.y_min);

                // Calculate distance to death position (2D distance, ignoring z)
                const dx = focusX - death.death_pos.x;
                const dy = focusY - death.death_pos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance <= PROXIMITY_THRESHOLD) {
                  wasNearby = true;
                  break;
                }
              }
            }
          }
          if (wasNearby) break;
        }
      }

      if (died || kills > 0 || wasNearby) {
        participated.push({
          start_time_s: fight.start_time_s,
          won: fight.winner === playerTeam,
          kills: kills,
          died: died,
          ...(wasNearby && { nearby: true }),
        });
      }
    }

    // Calculate overall stats
    const totalFights = teamfights.length;
    const participatedCount = participated.length;
    const wonCount = participated.filter((f) => f.won).length;

    teamfightStats = {
      total_teamfights: totalFights,
      participated: participatedCount,
      won: wonCount,
      lost: participatedCount - wonCount,
      participation_rate:
        totalFights > 0
          ? Math.round((participatedCount / totalFights) * 100)
          : 0,
      fights: participated,
    };
  }

  return {
    ...baseStats,
    items: itemPurchases,
    abilities: abilityPurchases,
    damage_breakdown: buildFocusPlayerDamage(matchData, focusPlayerId),
    ...(teamfightStats && { teamfight_stats: teamfightStats }),
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

function calculateDistance(pos1, pos2) {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function prepareMatchTimeline(matchData) {
  const events = [];

  // Add all hero kills
  for (const player of matchData.players) {
    const heroName = DeadlockConstants.heroes[player.hero_id]?.name || "Unknown";

    if (player.death_details) {
      for (const death of player.death_details) {
        // Find the killer
        const killer = matchData.players.find(
          (p) => p.player_slot === death.killer_player_slot
        );
        const killerName = killer
          ? DeadlockConstants.heroes[killer.hero_id]?.name || "Unknown"
          : "Unknown";

        events.push({
          type: "kill",
          time: death.game_time_s,
          killer: killerName,
          victim: heroName,
        });
      }
    }
  }

  // Add objective kills
  if (matchData.objectives) {
    for (const obj of matchData.objectives) {
      if (obj.destroyed_time_s > 0) {
        const teamName = obj.team === 0 ? "Amber Hand" : "Sapphire Flame";

        // Map objective IDs to readable names
        let objectiveName = `objective ${obj.team_objective_id}`;
        // You might want to add a mapping for objective IDs to names like "Guardian", "Walker", etc.

        events.push({
          type: "objective",
          time: obj.destroyed_time_s,
          team: teamName,
          objective: objectiveName,
          objective_id: obj.team_objective_id,
        });
      }
    }
  }

  // Add Mid Boss kills
  if (matchData.mid_boss) {
    for (const mbEvent of matchData.mid_boss) {
      if (mbEvent.team_claimed !== undefined && mbEvent.team_killed_time_s) {
        const teamName = mbEvent.team_claimed === 0 ? "Amber Hand" : "Sapphire Flame";
        events.push({
          type: "mid_boss",
          time: mbEvent.team_killed_time_s,
          team: teamName,
        });
      }
    }
  }

  // Sort all events by time
  events.sort((a, b) => a.time - b.time);

  return events;
}

function detectTeamfights(matchData) {
  // Collect all deaths with full context
  const allDeaths = [];

  for (const player of matchData.players) {
    if (!player.death_details) continue;

    for (const death of player.death_details) {
      allDeaths.push({
        victim_slot: player.player_slot,
        victim_team: player.team,
        killer_slot: death.killer_player_slot,
        game_time_s: death.game_time_s,
        position: death.death_pos,
      });
    }
  }

  // Sort deaths by time
  allDeaths.sort((a, b) => a.game_time_s - b.game_time_s);

  const TIME_WINDOW = 75; // seconds
  const DISTANCE_THRESHOLD = 2000; // units
  const MIN_DEATHS = 3;

  const teamfights = [];
  const usedDeaths = new Set();

  for (let i = 0; i < allDeaths.length; i++) {
    if (usedDeaths.has(i)) continue;

    const anchorDeath = allDeaths[i];
    const fightDeaths = [i];

    // Find deaths within time and distance window
    for (let j = i + 1; j < allDeaths.length; j++) {
      if (usedDeaths.has(j)) continue;

      const candidateDeath = allDeaths[j];

      // Check time window
      if (candidateDeath.game_time_s - anchorDeath.game_time_s > TIME_WINDOW) {
        break; // Deaths are sorted, so we can stop here
      }

      // Check distance to any death already in this fight
      let withinDistance = false;
      for (const deathIdx of fightDeaths) {
        const fightDeath = allDeaths[deathIdx];
        const distance = calculateDistance(
          candidateDeath.position,
          fightDeath.position,
        );
        if (distance <= DISTANCE_THRESHOLD) {
          withinDistance = true;
          break;
        }
      }

      if (withinDistance) {
        fightDeaths.push(j);
      }
    }

    // Check if this is a significant teamfight
    if (fightDeaths.length >= MIN_DEATHS) {
      const deaths = fightDeaths.map((idx) => allDeaths[idx]);

      // Count teams involved
      const team0Deaths = deaths.filter((d) => d.victim_team === 0).length;
      const team1Deaths = deaths.filter((d) => d.victim_team === 1).length;

      // Require both teams to have at least one death for it to be a "teamfight"
      if (team0Deaths > 0 && team1Deaths > 0) {
        const startTime = deaths[0].game_time_s;
        const endTime = deaths[deaths.length - 1].game_time_s;

        // Determine winner (team with fewer deaths)
        const winner = team0Deaths < team1Deaths ? 0 : 1;

        teamfights.push({
          start_time_s: Math.round(startTime),
          duration_s: Math.round(endTime - startTime),
          team0_deaths: team0Deaths,
          team1_deaths: team1Deaths,
          winner: winner,
          participants: deaths.map((d) => d.victim_slot),
        });

        // Mark these deaths as used
        fightDeaths.forEach((idx) => usedDeaths.add(idx));
      }
    }
  }

  return teamfights;
}

function generateCompactMatch(matchData, focusPlayerId, itemsById) {
  // Calculate average match rank
  const avgRank = Math.round(
    (matchData.average_badge_team0 + matchData.average_badge_team1) / 2,
  );
  const matchRank = formatRank(avgRank);

  // Build custom stats lookup from definitions
  const customStatsLookup = {};
  if (matchData.custom_user_stats) {
    for (const def of matchData.custom_user_stats) {
      customStatsLookup[def.id] = def.name;
    }
  }

  // Create unified match timeline
  const timeline = prepareMatchTimeline(matchData);

  // Detect teamfights
  const teamfights = detectTeamfights(matchData);

  return {
    match_id: matchData.match_id,
    duration_seconds: matchData.match_duration_s,
    winning_team: matchData.winning_team,
    match_rank: matchRank,
    timeline: timeline,
    teamfights: teamfights,
    players: matchData.players.map((player) =>
      preparePlayer(
        player,
        focusPlayerId,
        itemsById,
        matchData.players,
        customStatsLookup,
        matchData,
        teamfights,
      ),
    ),
  };
}

function buildFocusPlayerDamage(matchData, focusPlayerId) {
  if (!matchData.damage_matrix?.damage_dealers) {
    return null;
  }

  // Find the focus player's player_slot
  const focusPlayer = matchData.players.find(
    (p) => p.account_id === focusPlayerId,
  );
  if (!focusPlayer) return null;

  const focusPlayerSlot = focusPlayer.player_slot;

  // Find damage dealt BY focus player
  const focusDealer = matchData.damage_matrix.damage_dealers.find(
    (d) => d.dealer_player_slot === focusPlayerSlot,
  );

  const damageDealt = [];
  if (focusDealer) {
    // Aggregate all damage sources to get total damage to each player
    const damageByTarget = {};
    for (const source of focusDealer.damage_sources) {
      for (const target of source.damage_to_players) {
        if (!damageByTarget[target.target_player_slot]) {
          damageByTarget[target.target_player_slot] = 0;
        }
        // Get the final damage value (last element in the array)
        const finalDamage = target.damage[target.damage.length - 1] || 0;
        damageByTarget[target.target_player_slot] += finalDamage;
      }
    }

    // Convert to array with hero names
    for (const [targetSlot, damage] of Object.entries(damageByTarget)) {
      const targetPlayer = matchData.players.find(
        (p) => p.player_slot === parseInt(targetSlot),
      );
      if (targetPlayer) {
        damageDealt.push({
          hero:
            DeadlockConstants.heroes[targetPlayer.hero_id]?.name || "Unknown",
          damage: Math.round(damage),
        });
      }
    }
  }

  // Find damage dealt TO focus player
  const damageReceived = [];
  for (const dealer of matchData.damage_matrix.damage_dealers) {
    if (dealer.dealer_player_slot === focusPlayerSlot) continue; // Skip self

    let totalDamageFromDealer = 0;
    for (const source of dealer.damage_sources) {
      const targetEntry = source.damage_to_players.find(
        (t) => t.target_player_slot === focusPlayerSlot,
      );
      if (targetEntry) {
        const finalDamage =
          targetEntry.damage[targetEntry.damage.length - 1] || 0;
        totalDamageFromDealer += finalDamage;
      }
    }

    if (totalDamageFromDealer > 0) {
      const dealerPlayer = matchData.players.find(
        (p) => p.player_slot === dealer.dealer_player_slot,
      );
      if (dealerPlayer) {
        damageReceived.push({
          hero:
            DeadlockConstants.heroes[dealerPlayer.hero_id]?.name || "Unknown",
          damage: Math.round(totalDamageFromDealer),
        });
      }
    }
  }

  return {
    damage_dealt: damageDealt.sort((a, b) => b.damage - a.damage),
    damage_received: damageReceived.sort((a, b) => b.damage - a.damage),
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
You are a precise, non-speculative analyst for Deadlock, the third-person hero shooter MOBA by Valve.
Use the supplied match data along with your knowledge of Deadlock.
Write concise, actionable insights about the specified player.
Refer to the player by the provided player name.
Return ONLY one JSON object that matches the schema exactly-no extra keys, no surrounding text or code fences.

TEAMS
- Team 0: The Amber Hand
- Team 1: The Sapphire Flame
- Always refer to teams by their names, not "Team 0" or "Team 1"

MATCH DATA FORMAT
- timeline: Unified chronological log of all match events including hero kills (killer/victim), objectives destroyed (team/objective), and Mid Boss kills (team). Use this to understand match flow and correlate events.

CONSTRAINTS
- Use only data explicitly present in JSON; never invent, infer, or speculate on missing values.
- Focus strictly on the focus player; all stats must come from that player's record.
- Round integers to whole numbers; use thousands separators for large numbers.
- Convert time values in seconds into mm:ss format when referencing them (e.g., time: 125 → "2:05").
- Format percentages as whole numbers with % symbol (e.g., 75% not 0.75).
- Comparisons only against values in this match (team averages, opponents).

ABILITY UPGRADES
- Abilities show progression with level 0 (base), level 1, level 2, etc.
- Higher level descriptions are additive - they build upon all previous levels.
- A level 2 ability has the effects from level 0, level 1, AND level 2 combined.

MAP & OBJECTIVES
- The map has 3 lanes with 2v2 composition per lane.
- Lane objectives (in order): Guardian (1 per lane) → Walker (1 per lane) → Base Guardians (2 per lane) → Shrines (2, shared) → Patron (2 phases, win condition).
- Taking objectives grants team-wide benefits, map control, and Souls (primary currency).
- Destroying enemy objectives unlocks additional flex slots for your team, allowing more items to be equipped.
- Mid Boss: Spawns periodically and provides powerful team-wide buffs including bonus stats and a revive effect. Highly contested objective that can swing matches.
- Urn deliveries: Provide team-wide soul bonuses and are valuable for team economy.

GAME MECHANICS
- PowerUp Permanent: Refers to permanent hero buffs obtained from Sinner's Sacrifice objectives (6 fixed locations per team) or from breaking Golden Statues scattered around the map.
- Cosmic Veils: Visual barriers located around the map at all juke rooms and beneath most structural arches that act as one-way vision blockers.
- Flex Slots: Players have limited item slots. Teams earn additional flex slots by destroying enemy objectives, allowing for more items and build flexibility.
- Item Categories: Items have three slot types - "weapon" (gun damage, fire rate, ammo), "vitality" (health, regen, survivability), and "spirit" (ability damage, cooldowns, spirit power). Most abilities scale with spirit power, making spirit items crucial for ability-focused heroes.

ROLE ANALYSIS
- Consider the player's role based on item builds, damage output, healing/utility stats, and playstyle.
- Carries typically focus on scaling damage items and high player damage.
- Supports typically build team utility items and provide healing/barriering.
- Identify the enemy player who appears to have filled the same role as the focus player based on hero choice, item builds, stats, and playstyle.
- Prioritize comparing the focus player against this role counterpart rather than raw team averages (e.g., carry vs carry, support vs support).
- Role-specific comparisons provide more meaningful context for performance evaluation.
- Frame strengths/weaknesses/recommendations according to the player's role and match context.

TEAMFIGHTS
- Teamfights are automatically detected based on clustered deaths (3+ deaths from both teams within ~75s and close proximity).
- The focus player has teamfight_stats showing participation, win/loss record, and individual fight performance.
- Participation is tracked via: kills (secured eliminations), died (was killed), and nearby (was in close proximity to deaths but didn't get kills/die).
- The nearby flag indicates the player was present at the fight and likely contributed through damage, healing, abilities, or other support without securing kills or dying.
- Use teamfight context to provide deeper insights: "Died early in teamfights" vs "Secured kills but survived" vs "Present but avoided deaths" vs "Avoided major fights entirely."
- Teamfight participation rate and win rate are key performance indicators.
- Consider whether deaths occurred in teamfights (impactful) vs solo (poor positioning/overextension).
- Highlight patterns: strong early teamfight performance, clutch late-game fights, or consistently dying first.

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
