"use strict";

import Discord from "../Discord.js";
import cache from "../cache.mjs";
import OpenDotaAPI from "../OpenDotaAPI.js";
import OpenAI from "../OpenAI.mjs";
import DotaConstants from "../DotaConstants.js";
import items from "dotaconstants/build/items.json" with { type: "json" };
import itemIds from "dotaconstants/build/item_ids.json" with { type: "json" };
import abilityIds from "dotaconstants/build/ability_ids.json" with { type: "json" };
import abilities from "dotaconstants/build/abilities.json" with { type: "json" };
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
} from "@aws-sdk/client-scheduler";
import crypto from "crypto";

const cacheNamespace = "dota-ai-analyzer";
const metaCacheNamespace = "dota-meta";
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
    const fullMatch = await OpenDotaAPI.getMatch(match_id);
    matchTimer.end();
    if (!fullMatch.od_data.has_parsed) {
      const parseTimer = createTimer("OpenDota parse request");
      await OpenDotaAPI.requestParse(match_id);
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

    const matchHeroesMeta = await loadMetaForGameMode(fullMatch);

    const popularItems = await loadPopularItemsForGameMode(
      fullMatch.game_mode,
      player.hero_id,
    );

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
      matchHeroesMeta,
      popularItems,
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

async function loadMetaForGameMode(match) {
  if (match.game_mode === 18) return undefined; // Ability Draft

  const timer = createTimer("meta data loading");
  const results = await loadMeta();
  timer.end();

  const matchHeroes = match.players.map((player) => player.hero);
  return matchHeroes.reduce((acc, hero) => {
    const position = results.heroes.indexOf(hero) + 1;
    if (position > 0) {
      acc[hero] = position;
    }
    return acc;
  }, {});
}

async function loadPopularItemsForGameMode(gameModeId, heroId) {
  if (gameModeId === 18) return undefined; // Ability Draft

  const timer = createTimer("hero item popularity loading");
  const heroItemPopularity = await OpenDotaAPI.getHeroItemPopularity(heroId);
  timer.end();
  return processPopularItems(heroItemPopularity, items);
}

async function loadMeta() {
  const cacheKey = "heroes-meta";

  const cachedMeta = await cache.get(metaCacheNamespace, cacheKey);
  if (cachedMeta) {
    return JSON.parse(cachedMeta);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url = new URL("https://dota2protracker.com/api/heroes/stats");
    url.search = new URLSearchParams({
      mmr: 7000,
      position: "all",
      min_matches: 20,
      period: 8,
      legacy: false,
    }).toString();

    const res = await fetch(url, {
      headers: { Referer: "https://dota2protracker.com/meta" }, // Sorry dota2protracker
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        heroes: [],
      };
    }

    const data = await res.json();
    const heroes = {};
    for (const hero of data) {
      if (hero.d2pt_rating > (heroes[hero.hero_id] ?? 0)) {
        heroes[hero.hero_id] = hero.d2pt_rating;
      }
    }

    const sortedHeroes = Object.entries(heroes)
      .toSorted(([, a], [, b]) => b - a)
      .map(([heroId]) => DotaConstants.heroes[Number(heroId)].name ?? "Unknown")
      .filter(Boolean);

    const metaData = {
      heroes: sortedHeroes,
    };

    await cache.set(
      metaCacheNamespace,
      cacheKey,
      JSON.stringify(metaData),
      ONE_DAY,
    );

    return metaData;
  } catch (err) {
    console.error(`Failed to load meta information: ${err}`);

    return {
      heroes: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function processPopularItems(itemPopularityData, itemsMapping) {
  const processPhase = (phaseItems) => {
    if (!phaseItems) return [];

    const itemsWithNames = Object.entries(phaseItems)
      .map(([itemId, count]) => {
        const itemName = itemIds[itemId];
        const itemData = itemsMapping[itemName];

        if (!itemData || !itemName) {
          return null;
        }

        // Filter out recipes by checking the item name
        if (itemName.includes("recipe")) {
          return null;
        }

        // Filter out basic component items (passive stat items with no active behavior)
        if (itemData.qual === "component" && !itemData.behavior) {
          return null;
        }

        // Filter out low-cost consumables (laning items), but keep high-impact consumables like Moon Shard
        if (itemData.qual === "consumable" && itemData.cost < 300) {
          return null;
        }

        return { name: itemData.dname, count };
      })
      .filter(Boolean)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((item) => item.name);

    return itemsWithNames;
  };

  const result = {
    early_game: processPhase(itemPopularityData.early_game_items),
    mid_game: processPhase(itemPopularityData.mid_game_items),
    late_game: processPhase(itemPopularityData.late_game_items),
  };

  return result;
}

async function generateCompactMatch(match, focusPlayerId) {
  const compactMatch = {
    durationSeconds: match.duration,
    winningTeam: match.radiant_win ? "radiant" : "dire",
    lobby: DotaConstants.lobbyTypes[match.lobby_type],
    gameMode: DotaConstants.gameModes[match.game_mode],
    radiantKills: match.radiant_score,
    direKills: match.dire_score,
    pick_bans:
      match.picks_bans?.map((pick_ban) => ({
        type: pick_ban.is_pick ? "pick" : "ban",
        hero: DotaConstants.heroes?.[pick_ban.hero_id]?.name || "Unknown",
        team: pick_ban.team === 0 ? "radiant" : "dire",
      })) || [],
    radiantGoldAdvantage: match.radiant_gold_adv,
    radiantXpAdvantage: match.radiant_xp_adv,
    players: preparePlayers(match, focusPlayerId),
    log: prepareLog(match),
    teamfights: processTeamfights(match, focusPlayerId),
  };

  return compactMatch;
}

const LANE_NAMES = {
  1: "Safe",
  2: "Middle",
  3: "Off",
};

function preparePlayers(match, focusPlayerId) {
  const isTurbo = DotaConstants.gameModes[match.game_mode] === "Turbo";

  return match.players.map((player) => {
    const isFocus = player.account_id === focusPlayerId;
    const team = player.team_number === 0 ? "radiant" : "dire";

    const baseStats = {
      focus: isFocus,
      playerId: player.account_id,
      hero: DotaConstants.heroes[player.hero_id]?.name || "Unknown",
      team: team,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      lastHits: player.last_hits,
      denies: player.denies,
      networth: player.net_worth,
      goldPerMinute: player.gold_per_min,
      xpPerMinute: player.xp_per_min,
      heroDamage: player.hero_damage,
      towerDamage: player.tower_damage,
      heroHealing: player.hero_healing,
      damageTaken: processDamageTaken(player.damage_taken),
      level: player.level,
      rank: getRankName(player.rank_tier),
      runesPickedUp: player.rune_pickups,
      teamfightParticipation: player.teamfight_participation,
      stunsSeconds: player.stuns,
      abandoned: player.leaver_status > 1,
      lane: LANE_NAMES[player.lane_role],
      lastHitTimes: player.lh_t,
      denyTimes: player.dn_t,
      xpTime: player.xp_t,
      goldTimes: player.gold_t,
      purchaseLog: player.purchase_log.map((log) => ({
        time: log.time,
        name: items[log.key].dname,
      })),
    };

    if (!isFocus) return baseStats;

    // Extract drafted abilities for Ability Draft mode from ability_upgrades_arr
    const isAbilityDraft = match.game_mode === 18;
    const draftedAbilities =
      isAbilityDraft && player.ability_upgrades_arr
        ? [...new Set(player.ability_upgrades_arr)]
            .map((abilityId) => {
              const abilityKey = abilityIds[abilityId];
              if (!abilityKey || abilityKey.includes("special_bonus")) {
                return null;
              }
              return abilities[abilityKey]?.dname || abilityKey;
            })
            .filter(Boolean)
            .sort()
        : undefined;

    return {
      ...baseStats,
      ...(draftedAbilities ? { draftedAbilities } : {}),
      vision: {
        placed: {
          observer: player.obs_placed,
          sentry: player.sen_placed,
        },
        destroyed: {
          observer: player.observer_kills,
          sentry: player.sentry_kills,
        },
        events: buildVisionEventList(player),
      },
      courierKills: player.courier_kills,
      campsStacked: player.camps_stacked,
      combatAnalysis: processCombatAnalysis(player),
      chat: match.chat
        .filter(
          (msg) =>
            msg.player_slot === player.player_slot && msg.type === "chat",
        )
        .map((msg) => ({ time: msg.time, message: msg.key })),
      ...(!isTurbo
        ? {
            benchmarks: Object.entries(player.benchmarks).reduce(
              (acc, [name, benchmark]) => {
                acc[name] = (benchmark.pct * 100).toFixed(2);
                return acc;
              },
              {},
            ),
          }
        : {}),
    };
  });
}

function heroByRaw(raw) {
  return Object.values(DotaConstants.heroes).find(
    (hero) => hero.raw_name === raw,
  );
}

function processDamageTaken(damageTaken) {
  if (!damageTaken) return {};

  const processed = {
    heroes: {},
    towers: 0,
    creeps: 0,
    neutrals: 0,
    roshan: 0,
    other: {},
  };

  Object.entries(damageTaken).forEach(([source, damage]) => {
    if (source.startsWith("npc_dota_hero_")) {
      const hero = heroByRaw(source);
      const heroName = hero ? hero.name : source;
      processed.heroes[heroName] = damage;
    } else if (source.includes("_tower")) {
      processed.towers += damage;
    } else if (
      source.startsWith("npc_dota_creep_") ||
      source.includes("_siege")
    ) {
      processed.creeps += damage;
    } else if (source.startsWith("npc_dota_neutral_")) {
      processed.neutrals += damage;
    } else if (source === "npc_dota_roshan") {
      processed.roshan += damage;
    } else {
      processed.other[source] = damage;
    }
  });

  return processed;
}

function processCombatAnalysis(player) {
  const analysis = {};

  if (player.ability_uses) {
    Object.entries(player.ability_uses).forEach(([ability, uses]) => {
      const abilityName = ability === "null" ? "auto_attack" : ability;
      if (!analysis[abilityName]) analysis[abilityName] = {};
      analysis[abilityName].uses = uses;
    });
  }

  if (player.item_uses) {
    Object.entries(player.item_uses).forEach(([item, uses]) => {
      if (!analysis[item]) analysis[item] = {};
      analysis[item].uses = uses;
    });
  }

  if (player.ability_targets) {
    Object.entries(player.ability_targets).forEach(([ability, targets]) => {
      const abilityName = ability === "null" ? "auto_attack" : ability;
      if (!analysis[abilityName]) analysis[abilityName] = {};
      const processedTargets = {};
      Object.entries(targets).forEach(([target, count]) => {
        if (target.startsWith("npc_dota_hero_")) {
          const hero = heroByRaw(target);
          const heroName = hero ? hero.name : target;
          processedTargets[heroName] = count;
        } else {
          processedTargets[target] = count;
        }
      });
      analysis[abilityName].targets = processedTargets;
    });
  }

  if (player.damage_targets) {
    Object.entries(player.damage_targets).forEach(([ability, targets]) => {
      const abilityName = ability === "null" ? "auto_attack" : ability;
      if (!analysis[abilityName]) analysis[abilityName] = {};
      const processedDamage = {};
      Object.entries(targets).forEach(([target, damage]) => {
        if (target.startsWith("npc_dota_hero_")) {
          const hero = heroByRaw(target);
          const heroName = hero ? hero.name : target;
          processedDamage[heroName] = damage;
        } else {
          processedDamage[target] = damage;
        }
      });
      analysis[abilityName].damage = processedDamage;
    });
  }

  if (player.hero_hits) {
    Object.entries(player.hero_hits).forEach(([ability, hits]) => {
      const abilityName = ability === "null" ? "auto_attack" : ability;
      if (!analysis[abilityName]) analysis[abilityName] = {};
      analysis[abilityName].hits = hits;
    });
  }

  return analysis;
}

function buildVisionEventList(player) {
  const rawPlayerHero = DotaConstants.heroes[player.hero_id]?.raw_name;

  const events = [];
  for (const event of player.obs_log) {
    events.push({
      id: event.ehandle,
      type: "observer",
      placed: event.time,
      x: event.x,
      y: event.y,
      removed: null,
      reason: "expire",
      removedBy: null,
    });
  }

  for (const event of player.sen_log) {
    events.push({
      id: event.ehandle,
      type: "sentry",
      placed: event.time,
      x: event.x,
      y: event.y,
      removed: null,
      reason: "expire",
      removedBy: null,
    });
  }

  for (const event of player.obs_left_log) {
    const placeEvent = events.find(
      (ev) => ev.type === "observer" && ev.id === event.ehandle,
    );
    if (!placeEvent) continue;

    placeEvent.removed = event.time;
    if (!event.attackername || event.attackername === rawPlayerHero) {
      placeEvent.reason = "expire";
    } else {
      placeEvent.reason = "deward";
      placeEvent.removedBy =
        heroByRaw(event.attackername)?.name || event.attackername;
    }
  }

  for (const event of player.sen_left_log) {
    const placeEvent = events.find(
      (ev) => ev.type === "sentry" && ev.id === event.ehandle,
    );
    if (!placeEvent) continue;

    placeEvent.removed = event.time;
    if (!event.attackername || event.attackername === rawPlayerHero) {
      placeEvent.reason = "expire";
    } else {
      placeEvent.reason = "deward";
      placeEvent.removedBy =
        heroByRaw(event.attackername)?.name || event.attackername;
    }
  }

  events.sort((a, b) => a.placed - b.placed);

  for (const ev of events) delete ev.id;
  return events;
}

const LOG_HANDLERS = {
  CHAT_MESSAGE_FIRSTBLOOD: handleLogFirstBlood,
  building_kill: handleLogBuildingKill,
  CHAT_MESSAGE_ROSHAN_KILL: handleLogRoshanKill,
};

function handleLogFirstBlood(message, players) {
  const killer =
    DotaConstants.heroes[players[message.slot].hero_id]?.name ?? "Unknown";
  const victim =
    DotaConstants.heroes[players[message.key].hero_id]?.name ?? "Unknown";

  return {
    time: message.time,
    message: `${killer} drew first blood against ${victim}`,
  };
}

function handleLogBuildingKill(message, players) {
  if (message.key.endsWith("fort")) return null;

  const team = message.key.includes("goodguys") ? "Radiant" : "Dire";
  let location = "";
  if (message.key.endsWith("bot")) {
    location = "bottom";
  } else if (message.key.endsWith("top")) {
    location = "top";
  } else if (message.key.endsWith("mid")) {
    location = "middle";
  }

  let building = "";
  if (message.key.includes("tower")) {
    const tier = message.key.match(/\d/)[0];
    building = `tier ${tier} tower`;
  } else if (message.key.includes("range_rax")) {
    building = "ranged barracks";
  } else if (message.key.includes("melee_rax")) {
    building = "melee barracks";
  } else {
    console.error(`Unsupported building kill: ${message.key}`);
    building = message.key;
  }

  const parts = [];
  if (location) parts.push(location);
  if (building) parts.push(building);

  const fullBuilding = parts.join(" ");

  return {
    time: message.time,
    message: `${team}'s ${fullBuilding} was destroyed`,
  };
}

function handleLogRoshanKill(message, players) {
  const team = message.team === 2 ? "Radiant" : "Dire";

  return {
    time: message.time,
    message: `${team} killed roshan`,
  };
}

function prepareLog(match) {
  const players = Object.values(match.players).reduce((acc, player) => {
    acc[player.player_slot] = player;
    return acc;
  }, {});

  const messages = [];
  for (const message of match.objectives) {
    if (message.type in LOG_HANDLERS) {
      const result = LOG_HANDLERS[message.type](message, match.players);
      if (result !== null) messages.push(result);
    }
  }

  for (const player of Object.values(players)) {
    const hero = DotaConstants.heroes[player.hero_id];
    for (const message of player.kills_log) {
      const victim = Object.values(DotaConstants.heroes).find(
        (h) => h.raw_name === message.key,
      );
      messages.push({
        time: message.time,
        message: `${hero.name} killed ${victim?.name}`,
      });
    }

    for (const log of player.buyback_log) {
      messages.push({
        time: log.time,
        message: `${hero.name} bought back`,
      });
    }
  }

  messages.sort((a, b) => a.time - b.time);

  return messages;
}

function getRankName(rankTier) {
  if (!rankTier) return DotaConstants.rankTiers[0];

  const tier = Math.floor(rankTier / 10);
  const subTier = rankTier % 10;

  return `${DotaConstants.rankTiers[tier]} ${subTier}`;
}

function processTeamfights(match, focusPlayerId) {
  if (!match.teamfights || match.teamfights.length === 0) {
    return [];
  }

  return match.teamfights.map((teamfight) => {
    const radiantStats = {
      deaths: 0,
      deathHeroes: [],
      buybacks: 0,
      damage: 0,
      healing: 0,
      goldDelta: 0,
      xpDelta: 0,
    };

    const direStats = {
      deaths: 0,
      deathHeroes: [],
      buybacks: 0,
      damage: 0,
      healing: 0,
      goldDelta: 0,
      xpDelta: 0,
    };

    let focusPlayerStats = null;

    teamfight.players.forEach((playerTF, index) => {
      const player = match.players[index];
      const isRadiant = player.team_number === 0;
      const teamStats = isRadiant ? radiantStats : direStats;
      const heroName = DotaConstants.heroes[player.hero_id]?.name || "Unknown";

      const playerDeaths = playerTF.deaths || 0;
      teamStats.deaths += playerDeaths;
      if (playerDeaths > 0) {
        for (let i = 0; i < playerDeaths; i++) {
          teamStats.deathHeroes.push(heroName);
        }
      }

      teamStats.buybacks += playerTF.buybacks || 0;
      teamStats.damage += playerTF.damage || 0;
      teamStats.healing += playerTF.healing || 0;
      teamStats.goldDelta += playerTF.gold_delta || 0;
      teamStats.xpDelta += playerTF.xp_delta || 0;

      if (player.account_id === focusPlayerId) {
        const killedHeroes = playerTF.killed
          ? Object.keys(playerTF.killed).map((heroKey) => {
              const hero = Object.values(DotaConstants.heroes).find(
                (h) => h.raw_name === heroKey,
              );
              return hero?.name || heroKey;
            })
          : [];

        focusPlayerStats = {
          deaths: playerTF.deaths || 0,
          kills: killedHeroes.length,
          killedHeroes,
          damage: playerTF.damage || 0,
          healing: playerTF.healing || 0,
          goldDelta: playerTF.gold_delta || 0,
          xpDelta: playerTF.xp_delta || 0,
          buyback: (playerTF.buybacks || 0) > 0,
          abilityUses: playerTF.ability_uses || {},
          itemUses: playerTF.item_uses || {},
        };
      }
    });

    return {
      start: teamfight.start,
      end: teamfight.end,
      radiant: radiantStats,
      dire: direStats,
      focusPlayerStats,
    };
  });
}

async function analyzeMatch(
  match,
  matchHeroesMeta,
  popularItems,
  playerId,
  playerName,
  fullMatch,
) {
  const player = match.players.find((p) => p.playerId === playerId);
  const heroName = player?.hero || "Unknown";

  const prompt = [
    // Static system prompt (always cached)
    { role: "system", content: SYSTEM_PROMPT.trim() },
  ];

  // Meta heroes for this match composition (cached per hero lineup)
  if (matchHeroesMeta) {
    prompt.push({
      role: "system",
      content: `Meta Heroes for this match (high-MMR ranking, 1=strongest):\n${JSON.stringify(matchHeroesMeta)}`,
    });
  }

  // Popular items for this specific hero (cached per hero type)
  if (popularItems) {
    prompt.push({
      role: "system",
      content: `Popular Items for ${heroName} by game phase (from last 100 professional matches):\n${JSON.stringify(popularItems)}`,
    });
  }

  // Add game mode-specific rules if available (cached separately per mode)
  if (GAME_MODE_ADDENDUM[fullMatch.game_mode]) {
    prompt.push({
      role: "system",
      content: GAME_MODE_ADDENDUM[fullMatch.game_mode].trim(),
    });
  }

  // Dynamic match data and player info (never cached)
  prompt.push({
    role: "user",
    content: `Analyze this match for player ${playerName} (ID: ${playerId}) playing ${heroName}:\n\n${JSON.stringify(match)}`,
  });

  console.log("Analyzing Match", { prompt });

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
You are a precise, non-speculative Dota 2 analyst. Use the supplied OpenDota data along with your knowledge of Dota 2.
Write concise, actionable insights about the specified player.
Refer to the player by the provided player name.
Return ONLY one JSON object that matches the schema exactly-no extra keys, no surrounding text or code fences.

MATCH DATA FORMAT
- lastHitTimes, denyTimes, xpTime, goldTimes: Arrays of cumulative values at each minute mark (index 0 = minute 0, index 10 = minute 10, etc.)
- radiantGoldAdvantage, radiantXpAdvantage: Arrays showing advantage over time at each minute

CONSTRAINTS
- Use only data explicitly present in JSON; never invent, infer, or speculate on missing values.
- Focus strictly on the specified player_id; all stats must come from that player's record.
- Round integers to whole numbers; use thousands separators for large numbers.
- Convert JSON timestamps into mm:ss format; don't add timestamps to stats without time values.
- Format percentages as whole numbers with % symbol (e.g., 75% not 0.75).
- Comparisons only against values in this match (team averages, lane opponents, enemy cores).

ROLE AWARENESS
- Infer the player's role (pos 1-5) from lane, hero, and early stats.
- Evaluate performance relative to that role's responsibilities.
- Do not penalize supports for low tower or hero damage, or cores for low warding.
- Frame strengths/weaknesses/recommendations according to role expectations.

VISION & WARDING
- Use ward position data (x, y coordinates) to identify patterns like repeated ward spots.
- Comment on ward diversity if positions show clustering in same areas (poor coverage).
- Focus on ward timing relative to objectives or game phases when relevant.
- Do not list raw ward counts unless they are impactful relative to role or peers.
- Never include specific coordinate values (x, y positions) in your output.

DAMAGE ANALYSIS
- Use damageTaken breakdown to identify survivability issues and positioning problems.
- Analyze combatAnalysis for ability/item usage efficiency and target prioritization.
- Compare uses vs hits vs damage to assess accuracy and effectiveness.
- Many abilities are legitimately used for farming/wave clear; don't criticize high uses without hero hits unless it's a key single-target ability or long-cooldown ultimate.
- Suggest itemization based on damage sources (BKB for magical, armor for physical).
- Identify unused or underused abilities/items that could improve performance.

TEAMFIGHT ANALYSIS
- Evaluate player performance in major engagements using teamfights data.
- Assess damage/healing contributions vs team totals, economic impact (gold/XP deltas), and buyback timing.
- Consider team composition, role, and performance patterns in winning vs losing fights.

ANALYSIS STANDARDS
- List only meaningful contributions that stand out for the role.
- Avoid trivial accomplishments (1-2 stacks, minimal dewards) or raw counts unless impactful.
- When referencing items, analyze timing/impact relative to role and purchase timing.
- Don't criticize component item usage if likely upgraded; focus on final items and their purpose.

ITEM ANALYSIS
- Consider when items were purchased relative to game duration when evaluating usage counts.
- Items bought late in the match should not be criticized for low usage due to limited time available.
- Factor in item cooldowns when assessing if usage was reasonable for time owned.
- Late-game purchases may have been situational responses to immediate threats.

RECOMMENDATIONS
- Must align with actual Dota gameplay phases; avoid vague concepts.
- Use meta heroes only if relevant to player's hero/role (counters, alternatives).
- Don't attribute abilities heroes don't possess; assume healing/damage from items if no ability exists.
- Reference popular items data when making itemization suggestions; consider if player missed core items or made situational choices.

SUMMARY (<=250 words)
- Focus on player performance with qualitative interpretation, not raw K/D/A/GPM/XPM numbers.
- Include match closeness: "closely contested," "moderately one-sided," or "heavily one-sided."
- Add draft note if clearly imbalanced (severe counters, composition issues).
- Analyze player's impact across game phases (early, mid, late game) based on match context and duration.

STRENGTHS (1-5 items, <=25 words each)
- Meaningful advantages/successes for the role. Include metrics/timestamps only if useful.

WEAKNESSES (1-5 items, <=25 words each)
- Significant shortfalls relative to role. Omit if no clear weakness.

RECOMMENDATIONS (1-3 items, <=25 words each)
- Actionable by player alone; avoid vague language. At least one should build on a listed strength.
- Review chat for negative mindset (sarcasm, surrender language, frustration). If detected:
  Include one mindset recommendation as FINAL item, quoting relevant message.

SCHEMA
{
  "summary": string,
  "strengths": string[],
  "weaknesses": string[],
  "recommendations": string[],
}
`;

const GAME_MODE_ADDENDUM = {
  23: `
TURBO MODE
- This is a Turbo match. Economy and pacing stats (GPM, XPM, kills) are inflated by design.
- Do not call GPM/XPM/kill rates "high/low" unless explicitly relative to this match (team averages, lane opponent, enemy heroes).
- Popular item timings are based on professional matches and may not align with Turbo's accelerated pace; focus on item choices rather than timing criticism.
`,
  18: `
ABILITY DRAFT
- This is a Ability Draft match.
- Players drafted custom abilities; heroes don't have normal abilities.
- Focus on ability synergy and usage patterns from combatAnalysis and draftedAbilities.
- Evaluate items based on actual drafted abilities, not hero defaults.
- Don't reference abilities heroes "should have".
- Include an analysis of the drafted abilities in the summary.
`,
};

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
