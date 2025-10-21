import OpenDotaAPI from '../lib/OpenDotaAPI.mjs';
import DeadlockAPI from '../lib/DeadlockAPI.mjs';
import NoOpCache from './lib/NoOpCache.mjs';
import DotaConstants from '../lib/DotaConstants.js';
import * as DeadlockConstants from '../lib/DeadlockConstants.mjs';
import {
  generateCompactMatch as generateDeadlockCompactMatch,
  loadItems as loadDeadlockItems,
} from '../lib/DeadlockMatchProcessor.mjs';
import {
  generateCompactMatch as generateDotaCompactMatch,
  processPopularItems,
} from '../lib/DotaMatchProcessor.mjs';
import fs from 'fs/promises';

// Initialize API clients with NoOpCache for local testing
const openDotaAPI = new OpenDotaAPI(NoOpCache);
const deadlockAPI = new DeadlockAPI(NoOpCache);

// System prompts (copied from generate-eval.mjs)
const DOTA_SYSTEM_PROMPT = `
You are a precise, non-speculative Dota 2 analyst. Use the supplied OpenDota data along with your knowledge of Dota 2.
Write concise, actionable insights about the specified player.
Refer to the player by the provided player name.
Return ONLY one JSON object that matches the schema exactly-no extra keys, no surrounding text or code fences.

[Rest of system prompt truncated for brevity in test output]
`;

const DEADLOCK_SYSTEM_PROMPT = `
You are a precise, non-speculative analyst for Deadlock, the third-person hero shooter MOBA by Valve.
Use the supplied match data along with your knowledge of Deadlock.
Write concise, actionable insights about the specified player.
Refer to the player by the provided player name.
Return ONLY one JSON object that matches the schema exactly-no extra keys, no surrounding text or code fences.

[Rest of system prompt truncated for brevity in test output]
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    accountId: null,
    dotaMatchId: null,
    deadlockMatchId: null,
    deadlockPlayerName: null,
    output: null,
  };

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--account-id':
        parsed.accountId = value;
        break;
      case '--dota-match-id':
        parsed.dotaMatchId = value;
        break;
      case '--deadlock-match-id':
        parsed.deadlockMatchId = value;
        break;
      case '--deadlock-player-name':
        parsed.deadlockPlayerName = value;
        break;
      case '--output':
        parsed.output = value;
        break;
      default:
        console.error(`Unknown flag: ${flag}`);
        process.exit(1);
    }
  }

  const hasDota = parsed.dotaMatchId && parsed.accountId;
  const hasDeadlock = parsed.deadlockMatchId && parsed.accountId;

  if (!hasDota && !hasDeadlock) {
    console.error(
      'Error: Must provide --account-id and match ID for at least one game',
    );
    console.error(
      'Usage: node test-prompt-generation.mjs --account-id ID [--dota-match-id ID] [--deadlock-match-id ID [--deadlock-player-name NAME]] [--output FILE]',
    );
    process.exit(1);
  }

  return parsed;
}

function estimateTokens(text) {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

async function generateDotaPrompt(matchId, accountId) {
  console.log(`\n🔄 Fetching Dota match ${matchId} for account ${accountId}...`);

  const fullMatch = await openDotaAPI.getMatch(matchId);

  if (!fullMatch.od_data.has_parsed) {
    throw new Error(`Match ${matchId} has not been parsed by OpenDota`);
  }

  const player = fullMatch.players.find(
    (p) => p.account_id === Number(accountId),
  );
  if (!player) {
    throw new Error(`Account ${accountId} not found in match ${matchId}`);
  }

  const playerName = player.personaname;
  const playerHero = DotaConstants.heroes[player.hero_id].name;

  console.log(`✓ Found player: ${playerName} (${playerHero})`);

  // Skip meta data in test script (requires cache/DynamoDB)
  let matchHeroesMeta;
  console.log(`ℹ Skipping meta data (not needed for testing)`);

  let popularItems;
  if (fullMatch.game_mode !== 18) {
    try {
      const heroItemPopularity =
        await openDotaAPI.getHeroItemPopularity(player.hero_id);
      popularItems = processPopularItems(heroItemPopularity);
      console.log(`✓ Loaded popular items for ${playerHero}`);
    } catch (err) {
      console.warn(`⚠ Failed to load popular items: ${err.message}`);
    }
  }

  // Use production generateCompactMatch function
  console.log(`🔄 Generating compact match data...`);
  const compactMatch = generateDotaCompactMatch(fullMatch, Number(accountId));
  console.log(`✓ Generated compact match data`);

  const prompt = [{ role: 'system', content: DOTA_SYSTEM_PROMPT.trim() }];

  if (matchHeroesMeta) {
    prompt.push({
      role: 'system',
      content: `Meta Heroes for this match (high-MMR ranking, 1=strongest):\n${JSON.stringify(matchHeroesMeta)}`,
    });
  }

  if (popularItems) {
    prompt.push({
      role: 'system',
      content: `Popular Items for ${playerHero} by game phase (from last 100 professional matches):\n${JSON.stringify(popularItems)}`,
    });
  }

  prompt.push({
    role: 'user',
    content: `Analyze this match for player ${playerName} (ID: ${accountId}) playing ${playerHero}:\n\n${JSON.stringify(compactMatch)}`,
  });

  return { prompt, compactMatch, playerName, playerHero };
}

async function generateDeadlockPrompt(matchId, accountId, playerName = null) {
  console.log(
    `\n🔄 Fetching Deadlock match ${matchId} for account ${accountId}...`,
  );

  const rawMatchData = await deadlockAPI.getMatchMetadata(matchId);

  if (!rawMatchData?.match_info) {
    throw new Error(`Match data not available for match ${matchId}`);
  }

  const matchData = rawMatchData.match_info;

  const player = matchData.players.find(
    (p) => p.account_id === Number(accountId),
  );
  if (!player) {
    throw new Error(`Account ${accountId} not found in match ${matchId}`);
  }

  const playerHero = DeadlockConstants.heroes[player.hero_id]?.name || 'Unknown';
  console.log(`✓ Found player playing ${playerHero}`);

  // Load items data (required for generateCompactMatch)
  console.log(`🔄 Loading Deadlock items data...`);
  const itemsData = await loadDeadlockItems({ cache: NoOpCache, skipCache: true });
  console.log(`✓ Loaded items data`);

  // Use production generateCompactMatch function
  console.log(`🔄 Generating compact match data...`);
  const compactMatch = generateDeadlockCompactMatch(
    matchData,
    Number(accountId),
    itemsData,
  );
  console.log(`✓ Generated compact match data`);

  // Format player identifier like production (DeadlockAnalyst.mjs:1248)
  const playerIdentifier = playerName ? `player ${playerName}` : 'the player';

  const prompt = [
    { role: 'system', content: DEADLOCK_SYSTEM_PROMPT.trim() },
    {
      role: 'user',
      content: `Analyze this Deadlock match for ${playerIdentifier} playing ${playerHero}:\n\n${JSON.stringify(compactMatch)}`,
    },
  ];

  return { prompt, compactMatch, playerName: playerName || `Account ${accountId}`, playerHero };
}

function displayPrompt(gameName, promptData) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${gameName.toUpperCase()} PROMPT`);
  console.log('='.repeat(80));

  let totalTokens = 0;

  promptData.prompt.forEach((message, index) => {
    const tokens = estimateTokens(message.content);
    totalTokens += tokens;

    const preview = message.content.substring(0, 50);
    console.log(`[Message ${index + 1}] Role: ${message.role}, Estimated tokens: ~${tokens}`);
    console.log(`  Preview: "${preview}..."`);
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Total estimated tokens: ~${totalTokens}`);
  console.log('='.repeat(80));
}

async function main() {
  const args = parseArgs();
  const results = {
    timestamp: new Date().toISOString(),
    prompts: {},
  };

  console.log('🧪 Testing Prompt Generation');
  console.log('='.repeat(80));

  // Generate Dota prompt
  if (args.dotaMatchId && args.accountId) {
    try {
      const dotaData = await generateDotaPrompt(
        args.dotaMatchId,
        args.accountId,
      );
      displayPrompt('Dota 2', dotaData);

      results.prompts.dota = {
        match_id: args.dotaMatchId,
        account_id: args.accountId,
        player_name: dotaData.playerName,
        player_hero: dotaData.playerHero,
        prompt: dotaData.prompt,
        compact_match: dotaData.compactMatch,
      };
    } catch (err) {
      console.error(`\n❌ Failed to generate Dota prompt: ${err.message}`);
      console.error(err.stack);
    }
  }

  // Generate Deadlock prompt
  if (args.deadlockMatchId && args.accountId) {
    try {
      const deadlockData = await generateDeadlockPrompt(
        args.deadlockMatchId,
        args.accountId,
        args.deadlockPlayerName,
      );
      displayPrompt('Deadlock', deadlockData);

      results.prompts.deadlock = {
        match_id: args.deadlockMatchId,
        account_id: args.accountId,
        player_name: deadlockData.playerName,
        player_hero: deadlockData.playerHero,
        prompt: deadlockData.prompt,
        compact_match: deadlockData.compactMatch,
      };
    } catch (err) {
      console.error(`\n❌ Failed to generate Deadlock prompt: ${err.message}`);
      console.error(err.stack);
    }
  }

  // Save to file if requested
  if (args.output) {
    await fs.writeFile(args.output, JSON.stringify(results, null, 2));
    console.log(`\n✅ Saved prompts to ${args.output}`);
  }

  console.log(`\n✅ Prompt generation test complete!`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
