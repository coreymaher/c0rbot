import LLMClient from '../lib/LLMClient.mjs';
import OpenDotaAPI from '../lib/OpenDotaAPI.mjs';
import DeadlockAPI from '../lib/DeadlockAPI.mjs';
import NoOpCache from './lib/NoOpCache.mjs';
import DotaConstants from '../lib/DotaConstants.js';
import * as DeadlockConstants from '../lib/DeadlockConstants.mjs';
import { createRequire } from 'module';

// Load environment for API keys
const require = createRequire(import.meta.url);
const environmentConfig = require('../environment.js');
const environment = JSON.parse(environmentConfig.environment().environment);

// Create LLM client with API keys
const llm = new LLMClient({
  openai: environment.openai.apikey,
  anthropic: environment.anthropic.apikey,
  gemini: environment.gemini.apikey,
});
import {
  generateCompactMatch as generateDeadlockCompactMatch,
  loadItems as loadDeadlockItems,
  generateAnalysisPrompt as generateDeadlockAnalysisPrompt,
} from '../lib/DeadlockMatchProcessor.mjs';
import {
  generateCompactMatch as generateDotaCompactMatch,
  generateAnalysisPrompt as generateDotaAnalysisPrompt,
} from '../lib/DotaMatchProcessor.mjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize API clients with NoOpCache for local evaluation testing
const openDotaAPI = new OpenDotaAPI(NoOpCache);
const deadlockAPI = new DeadlockAPI(NoOpCache);

// Models to evaluate
const MODELS = [
  'gpt-5',
  'claude-sonnet-4-5',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
];

// Pricing per million tokens (as of October 2025)
// Source: Provider pricing pages
const PRICING = {
  'gpt-5': { input: 2.50, output: 10.00 },
  'gpt-5-mini': { input: 0.40, output: 1.60 },
  'gpt-5-nano': { input: 0.10, output: 0.40 },
  'claude-opus-4-1': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 0.80, output: 4.00 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.5-flash-lite': { input: 0.0375, output: 0.15 },
};

/**
 * Calculate cost for a model call
 * @param {string} model - Model name
 * @param {object} tokens - Token usage object
 * @returns {number} - Cost in USD
 */
function calculateCost(model, tokens) {
  const pricing = PRICING[model];
  if (!pricing) {
    return 0;
  }

  const inputCost = (tokens.prompt_tokens / 1_000_000) * pricing.input;
  const outputCost = (tokens.completion_tokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

// System prompts and helper functions are now in lib/DotaMatchProcessor.mjs and lib/DeadlockMatchProcessor.mjs

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    accountId: null,
    dotaMatchIds: [],
    deadlockMatchIds: [],
    deadlockName: null,
    models: MODELS, // Default to all models
  };

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--account-id':
        parsed.accountId = value;
        break;
      case '--dota-match-id':
        // Single match ID (backward compatibility)
        parsed.dotaMatchIds = [value];
        break;
      case '--dota-match-ids':
        // Multiple match IDs (comma-separated)
        parsed.dotaMatchIds = value.split(',').map((id) => id.trim());
        break;
      case '--deadlock-match-id':
        // Single match ID (backward compatibility)
        parsed.deadlockMatchIds = [value];
        break;
      case '--deadlock-match-ids':
        // Multiple match IDs (comma-separated)
        parsed.deadlockMatchIds = value.split(',').map((id) => id.trim());
        break;
      case '--deadlock-name':
        // Player name for Deadlock (API doesn't provide names)
        parsed.deadlockName = value;
        break;
      case '--models':
        // Comma-separated list of models
        parsed.models = value.split(',').map((model) => model.trim());
        break;
      default:
        console.error(`Unknown flag: ${flag}`);
        process.exit(1);
    }
  }

  // Validate that at least one game has match IDs and account ID
  const hasDota = parsed.dotaMatchIds.length > 0 && parsed.accountId;
  const hasDeadlock = parsed.deadlockMatchIds.length > 0 && parsed.accountId;

  if (!hasDota && !hasDeadlock) {
    console.error('Error: Must provide --account-id and match ID(s) for at least one game');
    console.error('Usage: node generate-eval.mjs --account-id ID [--dota-match-id ID | --dota-match-ids ID1,ID2,...] [--deadlock-match-id ID | --deadlock-match-ids ID1,ID2,...] [--deadlock-name NAME] [--models MODEL1,MODEL2,...]');
    process.exit(1);
  }

  // Validate Deadlock name is provided if Deadlock matches requested
  if (hasDeadlock && !parsed.deadlockName) {
    console.error('Error: Must provide --deadlock-name when evaluating Deadlock matches');
    console.error('(Deadlock API does not provide player names)');
    process.exit(1);
  }

  // Validate that all specified models are known (have pricing)
  for (const model of parsed.models) {
    if (!PRICING[model]) {
      console.error(`Warning: Model '${model}' does not have pricing information`);
    }
  }

  return parsed;
}

async function generateDotaPrompt(matchId, accountId) {
  console.log(`\nFetching Dota match ${matchId} for account ${accountId}...`);

  // Fetch match data
  const fullMatch = await openDotaAPI.getMatch(matchId);

  if (!fullMatch) {
    throw new Error(`Failed to fetch match ${matchId} from OpenDota API`);
  }

  if (!fullMatch.od_data?.has_parsed) {
    throw new Error(`Match ${matchId} has not been parsed by OpenDota`);
  }

  const player = fullMatch.players.find((p) => p.account_id === Number(accountId));
  if (!player) {
    throw new Error(`Account ${accountId} not found in match ${matchId}`);
  }

  const playerName = player.personaname;

  // Use production generateCompactMatch function
  console.log(`🔄 Generating compact match data...`);
  const compactMatch = generateDotaCompactMatch(fullMatch, Number(accountId));

  if (!compactMatch) {
    throw new Error(`Failed to generate compact match data for match ${matchId}`);
  }

  console.log(`✓ Generated compact match data`);

  // Use production generateAnalysisPrompt function (handles meta/items loading internally)
  console.log(`🔄 Generating analysis prompt...`);
  const prompt = await generateDotaAnalysisPrompt(compactMatch, Number(accountId), playerName, fullMatch, {
    cache: null, // No cache for evals
    getHeroItemPopularity: openDotaAPI.getHeroItemPopularity.bind(openDotaAPI),
  });

  console.log(`✓ Generated analysis prompt`);

  return { prompt, compactMatch, playerName };
}

async function generateDeadlockPrompt(matchId, accountId, playerName) {
  console.log(`\nFetching Deadlock match ${matchId} for ${playerName} (${accountId})...`);

  // Fetch match data
  const rawMatchData = await deadlockAPI.getMatchMetadata(matchId);

  if (!rawMatchData) {
    throw new Error(`Failed to fetch match ${matchId} from Deadlock API`);
  }

  if (!rawMatchData.match_info) {
    throw new Error(`Match data not available for match ${matchId} (missing match_info)`);
  }

  const matchData = rawMatchData.match_info;

  const player = matchData.players.find((p) => p.account_id === Number(accountId));
  if (!player) {
    throw new Error(`Account ${accountId} not found in match ${matchId}`);
  }

  const playerHero = DeadlockConstants.heroes[player.hero_id]?.name || 'Unknown';
  console.log(`✓ Found player playing ${playerHero}`);

  // Load items data (required for generateCompactMatch)
  console.log(`🔄 Loading Deadlock items data...`);
  const itemsData = await loadDeadlockItems({ cache: NoOpCache, skipCache: true });

  if (!itemsData || !itemsData.byId || !itemsData.byClassName) {
    throw new Error(`Failed to load Deadlock items data`);
  }

  if (Object.keys(itemsData.byId).length === 0) {
    throw new Error(`Deadlock items data is empty (0 items loaded)`);
  }

  console.log(`✓ Loaded Deadlock items data (${Object.keys(itemsData.byId).length} items)`);

  // Use production generateCompactMatch function
  console.log(`🔄 Generating compact match data...`);
  const compactMatch = generateDeadlockCompactMatch(
    matchData,
    Number(accountId),
    itemsData,
  );

  if (!compactMatch) {
    throw new Error(`Failed to generate compact match data for match ${matchId}`);
  }

  console.log(`✓ Generated compact match data`);

  // Use production generateAnalysisPrompt function
  console.log(`🔄 Generating analysis prompt...`);
  const prompt = generateDeadlockAnalysisPrompt(compactMatch, Number(accountId), playerName);

  console.log(`✓ Generated analysis prompt`);

  return { prompt, compactMatch, playerName };
}

async function runEvaluation(args) {
  const timestamp = new Date().toISOString();
  const resultsDir = path.join(__dirname, 'results');
  await fs.mkdir(resultsDir, { recursive: true });

  const evaluation = {
    timestamp,
    matches: [],
    results: [],
  };

  // Generate prompts for each Dota match
  // IMPORTANT: Do NOT catch errors - fail fast if data doesn't load correctly
  // This ensures evaluation uses EXACTLY the same data as production
  for (const matchId of args.dotaMatchIds) {
    const { prompt, compactMatch, playerName } = await generateDotaPrompt(
      matchId,
      args.accountId,
    );
    evaluation.matches.push({
      match_id: matchId,
      game: 'dota',
      account_id: args.accountId,
      player_name: playerName,
      prompt,
      compact_match: compactMatch,
    });
  }

  // Generate prompts for each Deadlock match
  // IMPORTANT: Do NOT catch errors - fail fast if data doesn't load correctly
  for (const matchId of args.deadlockMatchIds) {
    const { prompt, compactMatch, playerName } = await generateDeadlockPrompt(
      matchId,
      args.accountId,
      args.deadlockName,
    );
    evaluation.matches.push({
      match_id: matchId,
      game: 'deadlock',
      account_id: args.accountId,
      player_name: playerName,
      prompt,
      compact_match: compactMatch,
    });
  }

  // IMPORTANT: For each match, run all models
  // This ensures time between calls to the same model (prevents rate limiting)
  for (const match of evaluation.matches) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Running evaluation for ${match.game.toUpperCase()} - Match ${match.match_id}`);
    console.log('='.repeat(80));

    for (const model of args.models) {
      console.log(`\nTesting ${model}...`);

      try {
        const result = await llm.call(match.prompt, model);

        const cost = calculateCost(model, result.usage);

        evaluation.results.push({
          model: model,
          game: match.game,
          match_id: match.match_id,
          response_time_ms: result.response_time_ms,
          tokens: result.usage,
          cost_usd: cost,
          output: result.output,
          error: null,
        });

        console.log(`  ✓ Completed in ${result.response_time_ms}ms`);
        console.log(`  Tokens: ${result.usage.prompt_tokens} in / ${result.usage.completion_tokens} out`);
        console.log(`  Cost: $${cost.toFixed(4)}`);
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}`);
        evaluation.results.push({
          model: model,
          game: match.game,
          match_id: match.match_id,
          response_time_ms: null,
          tokens: null,
          cost_usd: null,
          output: null,
          error: err.message,
        });
      }

      // Add delay between API calls to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Save results
  const filename = `${timestamp.replace(/:/g, '-').replace(/\..+/, '')}.json`;
  const filepath = path.join(resultsDir, filename);
  await fs.writeFile(filepath, JSON.stringify(evaluation, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log('EVALUATION COMPLETE');
  console.log('='.repeat(80));
  console.log(`Evaluated ${evaluation.matches.length} matches × ${args.models.length} models`);
  console.log(`Results saved to: ${filepath}`);
  console.log(`\nRun evaluation with:`);
  console.log(`  node evaluate-results.mjs ${filepath}`);
}

// Main execution
const args = parseArgs();
runEvaluation(args).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
