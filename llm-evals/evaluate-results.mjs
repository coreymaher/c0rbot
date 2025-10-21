import fs from 'fs/promises';
import readline from 'readline';

const ELO_K_FACTOR = 32;
const INITIAL_ELO = 1500;

// Pricing per million tokens (as of October 2025)
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

function calculateCost(model, tokens) {
  const pricing = PRICING[model];
  if (!pricing || !tokens) {
    return null;
  }

  const inputCost = (tokens.prompt_tokens / 1_000_000) * pricing.input;
  const outputCost = (tokens.completion_tokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Error: Must provide results file path');
    console.error('Usage: node evaluate-results.mjs results/2025-10-15T12-34-56.json');
    process.exit(1);
  }

  return { resultsFile: args[0] };
}

async function loadResults(filepath) {
  const content = await fs.readFile(filepath, 'utf-8');
  return JSON.parse(content);
}

function initializeEloRatings(modelIds) {
  const ratings = {};
  for (const modelId of modelIds) {
    ratings[modelId] = INITIAL_ELO;
  }
  return ratings;
}

function calculateExpectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function updateEloRatings(ratings, modelA, modelB, outcome) {
  // outcome: 1 if A wins, 0 if B wins, 0.5 if tie

  const expectedA = calculateExpectedScore(ratings[modelA], ratings[modelB]);
  const expectedB = 1 - expectedA;

  ratings[modelA] += ELO_K_FACTOR * (outcome - expectedA);
  ratings[modelB] += ELO_K_FACTOR * ((1 - outcome) - expectedB);
}

function formatOutput(output) {
  if (!output) return 'ERROR: No output';

  const lines = [];

  // Handle haiku test format (simple haiku field)
  if (output.haiku) {
    lines.push(output.haiku);
    return lines.join('\n');
  }

  // Handle match analysis format (summary/strengths/weaknesses/recommendations)
  lines.push(`Summary: ${output.summary || 'N/A'}`);
  lines.push('');

  if (output.strengths && output.strengths.length > 0) {
    lines.push('Strengths:');
    output.strengths.forEach((s) => lines.push(`  - ${s}`));
    lines.push('');
  }

  if (output.weaknesses && output.weaknesses.length > 0) {
    lines.push('Focus Areas:');
    output.weaknesses.forEach((w) => lines.push(`  - ${w}`));
    lines.push('');
  }

  if (output.recommendations && output.recommendations.length > 0) {
    lines.push('Recommendations:');
    output.recommendations.forEach((r) => lines.push(`  - ${r}`));
  }

  return lines.join('\n');
}

function wrapText(text, width) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= width) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

function displayComparison(resultA, resultB, game, matchId) {
  console.clear();
  console.log('='.repeat(160));
  console.log(`MATCH: ${game.toUpperCase()} - Match ${matchId}`);
  console.log('='.repeat(160));
  console.log('');

  const width = 75;
  const leftTitle = `[1] Model ${resultA.model_id.split('_')[1].toUpperCase()}`;
  const rightTitle = `[2] Model ${resultB.model_id.split('_')[1].toUpperCase()}`;

  console.log(`${leftTitle.padEnd(width)} | ${rightTitle}`);
  console.log('-'.repeat(width) + '-+-' + '-'.repeat(width));

  const leftText = formatOutput(resultA.output);
  const rightText = formatOutput(resultB.output);

  // Wrap text instead of truncating
  const leftLines = leftText.split('\n').flatMap(line =>
    line.length > width ? wrapText(line, width) : [line]
  );
  const rightLines = rightText.split('\n').flatMap(line =>
    line.length > width ? wrapText(line, width) : [line]
  );

  const maxLines = Math.max(leftLines.length, rightLines.length);

  for (let i = 0; i < maxLines; i++) {
    const left = (leftLines[i] || '').padEnd(width);
    const right = (rightLines[i] || '');
    console.log(`${left} | ${right}`);
  }

  console.log('');
  console.log('-'.repeat(160));
  console.log('Which is better? (1/2/0=equal/s=skip/q=quit): ');
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function runComparisons(results, matches, game, ratings) {
  const gameResults = results.filter(
    (r) => r.game === game && r.output && !r.error,
  );

  if (gameResults.length < 2) {
    console.log(`\nNot enough successful results for ${game} (need at least 2)`);
    return [];
  }

  // Get all unique match IDs for this game
  const matchIds = [...new Set(gameResults.map((r) => r.match_id))];
  const modelIds = [...new Set(gameResults.map((r) => r.model_id))];

  // Generate all pairwise comparisons across all matches
  // For each match, compare all model pairs
  const pairs = [];
  for (const matchId of matchIds) {
    for (let i = 0; i < modelIds.length; i++) {
      for (let j = i + 1; j < modelIds.length; j++) {
        pairs.push({
          matchId,
          modelA: modelIds[i],
          modelB: modelIds[j],
        });
      }
    }
  }

  // Shuffle pairs for randomness
  pairs.sort(() => Math.random() - 0.5);

  const matchCount = matchIds.length;
  console.log(`\n=== Evaluating ${game.toUpperCase()} ===`);
  console.log(`${matchCount} match${matchCount > 1 ? 'es' : ''}, ${pairs.length} total comparisons\n`);

  let completedCount = 0;

  for (const pair of pairs) {
    const resultA = gameResults.find(
      (r) => r.model_id === pair.modelA && r.match_id === pair.matchId,
    );
    const resultB = gameResults.find(
      (r) => r.model_id === pair.modelB && r.match_id === pair.matchId,
    );

    if (!resultA || !resultB) {
      console.log(`\nWarning: Missing result for match ${pair.matchId}, skipping...`);
      continue;
    }

    // Randomly swap display order to avoid position bias
    const [displayFirst, displaySecond] =
      Math.random() > 0.5 ? [resultA, resultB] : [resultB, resultA];

    displayComparison(displayFirst, displaySecond, game, pair.matchId);

    const answer = await askQuestion('');

    if (answer === 'q' || answer === 'quit') {
      console.log('\nEvaluation interrupted by user');
      return { comparisons: [], completedCount, totalCount: pairs.length };
    }

    if (answer === 's' || answer === 'skip') {
      continue;
    }

    let outcome;
    if (answer === '1') {
      outcome = displayFirst.model_id === pair.modelA ? 1 : 0;
    } else if (answer === '2') {
      outcome = displaySecond.model_id === pair.modelA ? 1 : 0;
    } else if (answer === '0' || answer === 'equal') {
      outcome = 0.5;
    } else {
      console.log('Invalid input, skipping...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    // Update Elo ratings (accumulates across all matches)
    updateEloRatings(ratings, pair.modelA, pair.modelB, outcome);

    completedCount++;
    console.log(`\nComparison ${completedCount}/${pairs.length} completed`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return { comparisons: pairs.slice(0, completedCount), completedCount, totalCount: pairs.length };
}

function displayRankings(data, ratings, game, matchCount) {
  const gameResults = data.results.filter((r) => r.game === game && !r.error);

  // Calculate aggregate stats across all matches
  const stats = {};
  for (const result of gameResults) {
    const modelId = result.model_id;
    if (!stats[modelId]) {
      stats[modelId] = {
        model_id: modelId,
        model_name: data.models[modelId],
        response_times: [],
        tokens: [],
        costs: [],
      };
    }

    if (result.response_time_ms) {
      stats[modelId].response_times.push(result.response_time_ms);
    }

    if (result.tokens) {
      stats[modelId].tokens.push(result.tokens);

      // Calculate cost for this result (backward compatibility)
      const cost = result.cost_usd || calculateCost(data.models[modelId], result.tokens);
      if (cost !== null) {
        stats[modelId].costs.push(cost);
      }
    }
  }

  // Calculate averages
  const aggregated = Object.values(stats).map((s) => ({
    model_id: s.model_id,
    model_name: s.model_name,
    elo_rating: ratings[s.model_id] || INITIAL_ELO,
    avg_response_time:
      s.response_times.length > 0
        ? Math.round(
            s.response_times.reduce((a, b) => a + b, 0) /
              s.response_times.length,
          )
        : null,
    avg_prompt_tokens:
      s.tokens.length > 0
        ? Math.round(
            s.tokens.reduce((a, b) => a + b.prompt_tokens, 0) / s.tokens.length,
          )
        : null,
    avg_completion_tokens:
      s.tokens.length > 0
        ? Math.round(
            s.tokens.reduce((a, b) => a + b.completion_tokens, 0) /
              s.tokens.length,
          )
        : null,
    avg_cost:
      s.costs.length > 0
        ? s.costs.reduce((a, b) => a + b, 0) / s.costs.length
        : null,
  }));

  // Sort by Elo rating
  aggregated.sort((a, b) => b.elo_rating - a.elo_rating);

  console.clear();
  console.log('='.repeat(160));
  console.log(`FINAL RANKINGS - ${game.toUpperCase()} (${matchCount} match${matchCount > 1 ? 'es' : ''})`);
  console.log('='.repeat(160));
  console.log('');

  console.log(
    'Rank | Model                    | Quality | Speed  | Cost    | Q/Spd | Q/Cost | Tokens (in/out)',
  );
  console.log('-'.repeat(160));

  aggregated.forEach((item, index) => {
    const rank = (index + 1).toString().padEnd(4);
    const name = item.model_name.padEnd(24);
    const quality = Math.round(item.elo_rating).toString().padStart(7);
    const speed = (item.avg_response_time || 'N/A').toString().padStart(6);

    // Format cost
    const costStr = item.avg_cost !== null ? `$${item.avg_cost.toFixed(4)}` : 'N/A';
    const cost = costStr.padStart(7);

    // Calculate quality per second (higher is better)
    const qualityPerSpeed = item.avg_response_time
      ? (item.elo_rating / (item.avg_response_time / 1000)).toFixed(0)
      : 'N/A';
    const qSpeed = qualityPerSpeed.toString().padStart(5);

    // Calculate quality per dollar (higher is better)
    const qualityPerCost = item.avg_cost
      ? (item.elo_rating / item.avg_cost).toFixed(0)
      : 'N/A';
    const qCost = qualityPerCost.toString().padStart(6);

    const tokens = `${item.avg_prompt_tokens || 'N/A'} / ${item.avg_completion_tokens || 'N/A'}`;

    console.log(`${rank} | ${name} | ${quality} | ${speed}ms | ${cost} | ${qSpeed} | ${qCost} | ${tokens}`);
  });

  console.log('');
  console.log('Note: Stats averaged across all matches for this game');
  console.log('Q/Spd = Quality per second | Q/Cost = Quality per dollar');
  console.log('Higher values are better - indicates efficiency relative to speed/cost');
  console.log('');
  return aggregated;
}

async function saveEvaluation(filepath, data, evaluationResults) {
  data.evaluation = {
    evaluated_at: new Date().toISOString(),
    ...evaluationResults,
  };

  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  console.log(`\nEvaluation results saved to ${filepath}`);
}

async function displayInteractiveResults(data, evaluationResults, games) {
  while (true) {
    console.clear();
    console.log('='.repeat(160));
    console.log('EVALUATION RESULTS - INTERACTIVE VIEW');
    console.log('='.repeat(160));
    console.log('');

    for (const game of games) {
      const rankings = evaluationResults.rankings[game];
      if (!rankings) continue;

      const matches = data.matches || [];
      const matchCount = matches.filter(m => m.game === game).length;

      console.log(`\n${game.toUpperCase()} (${matchCount} match${matchCount > 1 ? 'es' : ''})`);
      console.log('-'.repeat(160));
      console.log('Rank | Model                    | Quality | Speed  | Cost    | Q/Spd | Q/Cost | Tokens (in/out)');
      console.log('-'.repeat(160));

      rankings.forEach((item, index) => {
        const rank = (index + 1).toString().padEnd(4);
        const name = item.model_name.padEnd(24);
        const quality = Math.round(item.elo_rating).toString().padStart(7);
        const speed = (item.avg_response_time || 'N/A').toString().padStart(6);

        const costStr = (item.avg_cost !== null && item.avg_cost !== undefined) ? `$${item.avg_cost.toFixed(4)}` : 'N/A';
        const cost = costStr.padStart(7);

        const qualityPerSpeed = item.avg_response_time
          ? (item.elo_rating / (item.avg_response_time / 1000)).toFixed(0)
          : 'N/A';
        const qSpeed = qualityPerSpeed.toString().padStart(5);

        const qualityPerCost = (item.avg_cost !== null && item.avg_cost !== undefined)
          ? (item.elo_rating / item.avg_cost).toFixed(0)
          : 'N/A';
        const qCost = qualityPerCost.toString().padStart(6);

        const tokens = `${item.avg_prompt_tokens || 'N/A'} / ${item.avg_completion_tokens || 'N/A'}`;

        console.log(`${rank} | ${name} | ${quality} | ${speed}ms | ${cost} | ${qSpeed} | ${qCost} | ${tokens}`);
      });
    }

    console.log('');
    console.log('='.repeat(160));
    console.log('Sort by: (q)uality | (s)peed | (c)ost | (v)alue (Q/Speed) | ($/Q)uality/Cost | (t)okens | (r)eset | (x)exit');

    const answer = await askQuestion('');

    if (answer === 'x' || answer === 'exit') {
      break;
    }

    // Sort rankings based on user choice
    for (const game of games) {
      if (!evaluationResults.rankings[game]) continue;

      const rankings = evaluationResults.rankings[game];

      switch (answer) {
        case 'q':
          rankings.sort((a, b) => b.elo_rating - a.elo_rating);
          break;
        case 's':
          rankings.sort((a, b) => (a.avg_response_time || Infinity) - (b.avg_response_time || Infinity));
          break;
        case 'c':
          rankings.sort((a, b) => (a.avg_cost || Infinity) - (b.avg_cost || Infinity));
          break;
        case 'v':
          rankings.sort((a, b) => {
            const aValue = a.avg_response_time ? a.elo_rating / (a.avg_response_time / 1000) : 0;
            const bValue = b.avg_response_time ? b.elo_rating / (b.avg_response_time / 1000) : 0;
            return bValue - aValue;
          });
          break;
        case '$':
          rankings.sort((a, b) => {
            const aValue = a.avg_cost ? a.elo_rating / a.avg_cost : 0;
            const bValue = b.avg_cost ? b.elo_rating / b.avg_cost : 0;
            return bValue - aValue;
          });
          break;
        case 't':
          rankings.sort((a, b) => (a.avg_completion_tokens || 0) - (b.avg_completion_tokens || 0));
          break;
        case 'r':
          rankings.sort((a, b) => b.elo_rating - a.elo_rating); // Reset to quality
          break;
      }
    }
  }
}

async function main() {
  const args = parseArgs();

  console.log('Loading results...');
  const data = await loadResults(args.resultsFile);

  // Handle both old format (data.games) and new format (data.matches)
  const matches = data.matches || [];
  const games = data.games ? Object.keys(data.games) : [...new Set(matches.map((m) => m.game))];

  // Assign hidden IDs to models for blind evaluation
  // If data.models already exists (old format), use it; otherwise create from results
  if (!data.models) {
    const modelNames = [...new Set(data.results.map((r) => r.model))];
    data.models = {};
    modelNames.forEach((model, index) => {
      const hiddenId = `model_${String.fromCharCode(97 + index)}`; // model_a, model_b, etc.
      data.models[hiddenId] = model;
    });

    // Update results to use hidden model_id instead of model name
    data.results = data.results.map((result) => {
      const hiddenId = Object.keys(data.models).find(
        (id) => data.models[id] === result.model
      );
      return {
        ...result,
        model_id: hiddenId,
      };
    });
  }

  console.log(`Loaded evaluation from ${data.timestamp}`);
  console.log(`Matches: ${matches.length || 'N/A'}`);
  console.log(`Games: ${games.join(', ')}`);
  console.log(`Models: ${Object.keys(data.models).length}`);
  console.log(`Results: ${data.results.length}`);

  // Check if already evaluated
  if (data.evaluation && data.evaluation.rankings && Object.keys(data.evaluation.rankings).length > 0) {
    console.log('\n⚠️  This file has already been evaluated!');
    console.log(`Evaluated at: ${data.evaluation.evaluated_at}`);
    console.log('');
    console.log('Options:');
    console.log('  (v)iew - View existing results');
    console.log('  (r)erun - Re-run evaluation (will overwrite existing results)');
    console.log('  (q)uit - Exit');

    const answer = await askQuestion('');

    if (answer === 'q' || answer === 'quit') {
      console.log('Exiting...');
      return;
    }

    if (answer === 'v' || answer === 'view') {
      // Recalculate costs for old evaluations that don't have them
      for (const game of games) {
        if (data.evaluation.rankings[game]) {
          for (const ranking of data.evaluation.rankings[game]) {
            if (ranking.avg_cost === null || ranking.avg_cost === undefined) {
              // Recalculate cost from tokens
              const gameResults = data.results.filter(
                (r) => r.game === game && r.model_id === ranking.model_id && !r.error
              );

              const costs = [];
              for (const result of gameResults) {
                if (result.tokens) {
                  const cost = result.cost_usd || calculateCost(ranking.model_name, result.tokens);
                  if (cost !== null) {
                    costs.push(cost);
                  }
                }
              }

              ranking.avg_cost = costs.length > 0
                ? costs.reduce((a, b) => a + b, 0) / costs.length
                : null;
            }
          }
        }
      }

      await displayInteractiveResults(data, data.evaluation, games);
      return;
    }

    if (answer !== 'r' && answer !== 'rerun') {
      console.log('Invalid option, exiting...');
      return;
    }

    console.log('\nRe-running evaluation...\n');
  }

  const evaluationResults = {
    comparisons: {},
    rankings: {},
  };

  // Run comparisons for each game
  for (const game of games) {
    const ratings = initializeEloRatings(Object.keys(data.models));
    const gameMatches = matches.filter((m) => m.game === game);
    const matchCount = gameMatches.length;

    const result = await runComparisons(data.results, matches, game, ratings);

    if (!result.comparisons || result.comparisons.length === 0) {
      console.log(`\nNo comparisons completed for ${game}`);
      continue;
    }

    evaluationResults.comparisons[game] = {
      comparisons: result.comparisons,
      completed: result.completedCount,
      total: result.totalCount,
    };

    // Display rankings
    const rankings = displayRankings(data, ratings, game, matchCount);
    evaluationResults.rankings[game] = rankings;

    console.log('\nPress Enter to continue...');
    await askQuestion('');
  }

  // Save evaluation results
  await saveEvaluation(args.resultsFile, data, evaluationResults);

  console.log('\n=== Evaluation Complete ===');
  console.log('');
  console.log('View results interactively? (y/n): ');

  const viewAnswer = await askQuestion('');

  if (viewAnswer === 'y' || viewAnswer === 'yes') {
    await displayInteractiveResults(data, evaluationResults, games);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
