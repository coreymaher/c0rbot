"use strict";

import Discord from "../Discord.js";
import cache from "../cache.mjs";
import OpenDotaAPI from "../OpenDotaAPI.js";
import OpenAI from "../OpenAI.mjs";
import DotaConstants from "../DotaConstants.js";
import items from "dotaconstants/build/items.json" with { type: "json" };

const cacheNamespace = "dota-ai-analyzer";

const environment = JSON.parse(process.env.environment);

const discord = new Discord();
discord.init(environment.discord);

export async function handler(event) {
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
      const cachedAnalysis = await cache.get(cacheNamespace, cacheKey);
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
    const fullMatch = await OpenDotaAPI.getMatch(match_id);
    if (!fullMatch.od_data.has_parsed) {
      await OpenDotaAPI.requestParse(match_id);

      await discord.sendInteractionResponse(application_id, interaction_token, {
        flags: 64,
        content: "Match has not been parsed by OpenDota. Try again later.",
        allowed_mentions: { parse: [] },
      });

      return;
    }

    const match = await generateCompactMatch(fullMatch, Number(player_id));
    const meta = await loadMeta();

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

    console.log("Match payload for LLM:", JSON.stringify(match, null, 2));

    const analysis = await analyzeMatch(
      match,
      meta,
      Number(player_id),
      playerName,
    );

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

    await cache.set(cacheNamespace, cacheKey, JSON.stringify(analysisPayload));
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

async function loadMeta() {
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

    return {
      heroes: sortedHeroes,
    };
  } catch (err) {
    console.error(`Failed to load meta information: ${err}`);

    return {
      heroes: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateCompactMatch(match, focusPlayerId) {
  const compactMatch = {
    durationSeconds: match.duration,
    winningTeam: match.radiant_win ? "radiant" : "dire",
    lobby: DotaConstants.lobbyTypes[match.lobby_type],
    gameMode: DotaConstants.gameModes[match.game_mode],
    radiantKills: match.radiant_score,
    direKills: match.dire_score,
    pick_bans: match.picks_bans.map((pick_ban) => ({
      type: pick_ban.is_pick ? "pick" : "ban",
      hero: DotaConstants.heroes?.[pick_ban.hero_id]?.name || "Unknown",
      team: pick_ban.team === 0 ? "radiant" : "dire",
    })),
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
      abandoned: player.leaver_status > 0,
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

    return {
      ...baseStats,
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

async function analyzeMatch(match, meta, playerId, playerName) {
  const prompt = [{ role: "system", content: SYSTEM_PROMPT.trim() }];

  // Add Turbo-specific rules only for Turbo games
  if (match.gameMode === "Turbo") {
    prompt.push({ role: "system", content: TURBO_ADDENDUM.trim() });
  }

  prompt.push({
    role: "user",
    content: USER_PROMPT.trim()
      .replace("{{PLAYER_ID}}", playerId)
      .replace("{{PLAYER_NAME}}", playerName)
      .replace("{{META_HEROES}}", JSON.stringify(meta.heroes))
      .replace("{{MATCH_JSON}}", JSON.stringify(match)),
  });

  const response = await OpenAI.chatCompletions(prompt, "gpt-5");

  return JSON.parse(response.choices[0].message.content);
}

const SYSTEM_PROMPT = `
You are a precise, non-speculative Dota 2 analyst. Use the supplied OpenDota data along with your knowledge of Dota 2.
Write concise, actionable insights about the specified player.
Refer to the player by the provided player name.
Return ONLY one JSON object that matches the schema exactly-no extra keys, no surrounding text or code fences.

CONSTRAINTS
- Treat the supplied match JSON as the sole ground truth.
- Never invent or infer factual values (lanes, stats, timings, roles, items, abilities, etc.)
  beyond what is explicitly present in the JSON.
- You may interpret or compare the supplied values, but all numbers, roles, and assignments
  must come directly from the JSON, not prior knowledge.
- Focus strictly on the specified player_id; when citing stats, read them from that player's record.
- Round integers to whole numbers; use thousands separators for large numbers.
- Convert timestamps already present in the JSON (e.g., from chat, purchases, deaths) into mm:ss format.
  Do not attach timestamps to stats that have no time value in the data.
- If data is missing or ambiguous, use empty arrays; never invent values.
- No speculation: do not use hedging language ("likely", "might"), emotions, or teammate blame.
- Comparisons: only compare against values present in this match (team averages, lane opponents, enemy cores).

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
- Suggest itemization based on damage sources (BKB for magical, armor for physical).
- Identify unused or underused abilities/items that could improve performance.

TEAMFIGHT ANALYSIS
- Use teamfights data to evaluate the player's performance in major engagements.
- Compare focus player's damage/healing contribution to team totals for each teamfight.
- Analyze teamfight timing: early game skirmishes vs late game decisive fights.
- Evaluate ability and item usage during teamfights for effectiveness and timing.
- Consider team composition and role when assessing teamfight performance.
- Look for patterns: does the player perform better in winning or losing teamfights?
- Assess economic impact: gold/XP deltas relative to deaths and team performance.
- Note buyback usage and timing in relation to teamfight outcomes.

STRENGTHS & WEAKNESSES
- List only meaningful contributions that stand out for the role.
- Do not include trivial or unimpressive contributions (e.g., 1-2 stacks, minimal dewards).
- Do not list raw counts unless they are impactful relative to role or peers.
- Avoid invented timing windows unless explicitly present in the data.

ITEMIZATION
- When referencing items, describe their timing or impact relative to the player's role.
- Do not list items without analysis of how they affected survivability, impact, or team outcomes.
- Consider item progression when analyzing usage - component items upgrade into complete items.
- Do not criticize low usage of component items that were likely upgraded (e.g., Pavise into Solar Crest).
- Focus analysis on final items and their intended purpose throughout the game.
- Consider purchase timing when analyzing item usage - items bought late in the game naturally have fewer usage opportunities.

MAP & GAMEPLAY PHASES
- Recommendations must align with actual Dota gameplay phases.
- Avoid vague or inapplicable concepts (e.g., "play high ground" during lane phase).

META HEROES
- Use only if relevant to the player's hero/role (e.g., draft fit, counters, or alternative picks).

HERO ABILITIES
- Do not attribute abilities to a hero that they do not actually possess.
- If healing/damage values are present but the hero has no such ability, assume contributions come from items, neutral items, or other sources.

SUMMARY
- Length: <= 300 words.
- Focus primarily on the player's performance.
- Do not include raw numeric values for K/D/A, GPM, XPM, hero damage, tower damage, or hero healing.
  Instead, provide qualitative or comparative interpretation (e.g., "low survivability," "above-average farming," "high teamfight damage").
- Always include one sentence about overall match closeness:
  - Use relative framing like "closely contested," "moderately one-sided," or "heavily one-sided."
  - Base this on team kill totals, gold/XP advantage trends, or final score margin.
- If the draft was clearly imbalanced (e.g., severe counter lanes, no frontline/disable, or poor damage mix), include a brief draft note.

STRENGTHS
- 1-5 items, each <= 25 words.
- Each strength must reflect a meaningful advantage or success for the role.
- Include a metric/timestamp only if it provides useful context.

WEAKNESSES
- 1-5 items, each <= 25 words.
- Each weakness must reflect a significant shortfall relative to the player's role.
- Omit if no clear weakness is present.

RECOMMENDATIONS
- 1-5 items, each <= 25 words.
- Must be actionable by the player alone (no teammate/draft/attitude advice).
- Avoid vague language ("improve impact") or generic phrases.
- At least one recommendation should build on a listed strength.
- Avoid overlap between weaknesses and recommendations phrased as mirror images.
- When referencing items, focus on how to use them better, not just purchase them.
- Always review the focus player's chat messages:
  - Treat repeated sarcasm, dismissive remarks, surrender language, or visible frustration as a NEGATIVE MINDSET.
    - A single polite "gg" at or near game end is never a negative mindset.
  - If a negative mindset is detected:
    - You MUST include exactly one mindset recommendation.
    - Place it as the FINAL recommendation.
    - Quote or paraphrase the relevant chat message.
    - This mindset recommendation is mandatory, even if it reduces the number of gameplay recommendations.

SCHEMA
{
  "summary": string,
  "strengths": string[],
  "weaknesses": string[],
  "recommendations": string[],
}
`;

const TURBO_ADDENDUM = `
TURBO MODE ADDENDUM
- This match is Turbo. Economy and pacing stats (GPM, XPM, kills) are inflated by design.
- Do not call GPM/XPM/kill rates "high/low" unless explicitly relative to this match (team averages, lane opponent, enemy heroes).
`;

const USER_PROMPT = `
PLAYER_ID:
{{PLAYER_ID}}

PLAYER_NAME:
{{PLAYER_NAME}}

Meta Heroes:
# Array of hero names sorted by recent high-MMR win/impact
{{META_HEROES}}

OpenDota Match Data:
{{MATCH_JSON}}
`;
