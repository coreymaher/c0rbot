import LLMClient from '../lib/LLMClient.mjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Models to test
const MODELS = [
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

// Test prompts (simulates multi-match evaluation)
const TEST_PROMPTS = [
  {
    id: 'dota-haiku',
    name: 'Dota 2 Haiku',
    prompt: [
      {
        role: 'user',
        content: 'Write me a haiku about Dota 2. Return ONLY a JSON object with a single field "haiku" containing the haiku text. No markdown formatting, no code fences, just the raw JSON.',
      },
    ],
  },
  {
    id: 'deadlock-haiku',
    name: 'Deadlock Haiku',
    prompt: [
      {
        role: 'user',
        content: 'Write me a haiku about Deadlock, the third-person hero shooter MOBA game by Valve. Return ONLY a JSON object with a single field "haiku" containing the haiku text. No markdown formatting, no code fences, just the raw JSON.',
      },
    ],
  },
];

async function testModel(model, promptInfo) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${model} - ${promptInfo.name}`);
  console.log('='.repeat(80));

  try {
    console.log(`Calling API...`);
    const result = await llm.call(promptInfo.prompt, model);

    console.log(`\n✅ Success! (${result.response_time_ms}ms)`);
    const tokenInfo = `Tokens: ${result.usage.prompt_tokens} in / ${result.usage.completion_tokens} out`;
    if (result.usage.reasoning_tokens > 0) {
      console.log(`${tokenInfo} (${result.usage.reasoning_tokens} reasoning)`);
    } else {
      console.log(tokenInfo);
    }
    console.log(`Output: [hidden to avoid bias]`);

    return {
      model: model,
      game: 'haiku-test',
      match_id: promptInfo.id,
      response_time_ms: result.response_time_ms,
      tokens: result.usage,
      output: result.output,
      error: null,
    };
  } catch (err) {
    console.error(`\n❌ Failed: ${err.message}`);

    return {
      model: model,
      game: 'haiku-test',
      match_id: promptInfo.id,
      response_time_ms: null,
      tokens: null,
      output: null,
      error: err.message,
    };
  }
}

async function main() {
  console.log('🧪 Testing Simple Haiku Generation (Multi-Prompt Pattern)');
  console.log('='.repeat(80));
  console.log(`Testing ${TEST_PROMPTS.length} prompts × ${MODELS.length} models...`);
  console.log('Prompts:');
  TEST_PROMPTS.forEach((p) => console.log(`  - ${p.name}: "${p.prompt[0].content}"`));
  console.log('\nExecution order: For each prompt, run all models');
  console.log('(This mirrors the real evaluation pattern)\n');

  const timestamp = new Date().toISOString();
  const evaluation = {
    timestamp,
    matches: TEST_PROMPTS.map((p) => ({
      match_id: p.id,
      game: 'haiku-test',
      prompt: p.prompt,
      name: p.name,
    })),
    results: [],
  };

  // Test each prompt against all models (mirrors real evaluation pattern)
  for (const promptInfo of TEST_PROMPTS) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TESTING PROMPT: ${promptInfo.name}`);
    console.log('='.repeat(80));

    for (const model of MODELS) {
      const result = await testModel(model, promptInfo);
      evaluation.results.push(result);

      // Small delay between API calls
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Display summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const totalTests = TEST_PROMPTS.length * MODELS.length;
  const successful = evaluation.results.filter((r) => !r.error);
  const failed = evaluation.results.filter((r) => r.error);

  console.log(`\n✅ Successful: ${successful.length}/${totalTests}`);
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length}/${totalTests}`);
    failed.forEach((r) => {
      const promptName = TEST_PROMPTS.find((p) => p.id === r.match_id)?.name;
      console.log(`  - ${r.model} (${promptName}): ${r.error}`);
    });
  }

  // Show results grouped by prompt
  if (successful.length > 0) {
    for (const promptInfo of TEST_PROMPTS) {
      const promptResults = successful.filter((r) => r.match_id === promptInfo.id);

      if (promptResults.length > 0) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`Results for: ${promptInfo.name}`);
        console.log('─'.repeat(80));

        // Speed comparison
        console.log(`\nSpeed Ranking:`);
        const sorted = [...promptResults].sort(
          (a, b) => a.response_time_ms - b.response_time_ms,
        );
        sorted.forEach((r, index) => {
          console.log(
            `  ${index + 1}. ${r.model.padEnd(25)} ${r.response_time_ms}ms`,
          );
        });

        // Token usage
        console.log(`\nToken Usage:`);
        sorted.forEach((r) => {
          console.log(
            `  ${r.model.padEnd(25)} ${r.tokens.prompt_tokens} in / ${r.tokens.completion_tokens} out`,
          );
        });
      }
    }
  }

  // Save results
  const resultsDir = path.join(__dirname, 'results');
  await fs.mkdir(resultsDir, { recursive: true });

  const filename = `haiku-test-${timestamp.replace(/:/g, '-').replace(/\..+/, '')}.json`;
  const filepath = path.join(resultsDir, filename);
  await fs.writeFile(filepath, JSON.stringify(evaluation, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Test complete! Results saved to:`);
  console.log(`   ${filepath}`);
  console.log(`\nYou can evaluate these results with:`);
  console.log(`   node evaluate-results.mjs ${filepath}`);
  console.log('='.repeat(80));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
