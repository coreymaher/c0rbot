# LLM Evaluation System

A two-script system for evaluating LLM performance on Dota 2 and Deadlock match analysis. Compare quality, speed, and token usage across OpenAI, Anthropic, and Google Gemini models through blind evaluation.

## Models Evaluated

### OpenAI (August 2025)
- `gpt-5` - Latest flagship model
- `gpt-5-mini` - Smaller, faster version
- `gpt-5-nano` - Most compact version

### Anthropic (October 2025)
- `claude-sonnet-4-5` - Latest frontier model, best coding performance
- `claude-haiku-4-5` - Small model with 90% of Sonnet 4.5 performance

### Google Gemini (2025)
- `gemini-2.5-pro` - Flagship with adaptive thinking
- `gemini-2.5-flash` - Fast, cost-efficient with thinking
- `gemini-2.5-flash-lite` - Most efficient

## Prerequisites

1. **Environment Variables**: Ensure `environment.js` in the parent directory contains API keys:
   ```javascript
   {
     openai: { apikey: "sk-..." },
     anthropic: { apikey: "sk-ant-..." },
     gemini: { apikey: "..." }
   }
   ```

2. **Node.js 22.x**: Uses ES modules and modern JavaScript features

## Workflow

### Step 1: Generate Evaluation Data

Run models against match data and save results:

```bash
node generate-eval.mjs \
  --dota-match-id 123456 \
  --dota-account-id 789012 \
  --deadlock-match-id 345678 \
  --deadlock-account-id 901234
```

**Options:**
- `--dota-match-id` + `--dota-account-id` - Dota 2 match to analyze
- `--deadlock-match-id` + `--deadlock-account-id` - Deadlock match to analyze
- At least one game must be specified

**Output:**
- Creates `results/{timestamp}.json` with:
  - Original prompts
  - Model responses (with hidden IDs)
  - Response times
  - Token usage
  - Any errors

**What it does:**
1. Fetches match data from OpenDota/Deadlock APIs
2. Generates prompts using existing analyst logic
3. Calls each model sequentially
4. Records performance metrics
5. Saves results with anonymized model IDs

### Step 2: Evaluate Results (Blind Ranking)

Interactive terminal UI for comparing model outputs:

```bash
node evaluate-results.mjs results/2025-10-15T12-34-56.json
```

**What it does:**
1. Loads results file
2. Presents pairwise comparisons side-by-side
3. Hides model identities during evaluation
4. Collects user preferences (1/2/0=equal/s=skip/q=quit)
5. Calculates Elo ratings based on comparisons
6. Displays final rankings with quality scores
7. Reveals model identities
8. Saves rankings back to results file

**Example comparison screen:**
```
================================================================================
MATCH: DOTA 2 - Match 123456
================================================================================

[1] Model A                    [2] Model B
--------------------------------------------------------------------------------
Summary: ...                   Summary: ...
Strengths:                     Strengths:
  - ...                          - ...

Which is better? (1/2/0=equal/s=skip/q=quit): _
```

**Final rankings table:**
```
================================================================================================
FINAL RANKINGS - DOTA 2 (1 match)
================================================================================================

Rank | Model                    | Quality | Speed  | Cost    | Q/Spd | Q/Cost | Tokens (in/out)
------------------------------------------------------------------------------------------------
1    | claude-sonnet-4-5        |    1623 |  1234ms | $0.0012 |  1315 | 135250 | 5000 / 456
2    | gpt-5                    |    1589 |  2345ms | $0.0234 |   677 |  67906 | 4800 / 512
3    | gemini-2.5-flash         |    1544 |   987ms | $0.0003 |  1564 | 514667 | 5100 / 478
...

Note: Stats averaged across all matches for this game
Q/Spd = Quality per second | Q/Cost = Quality per dollar
Higher values are better - indicates efficiency relative to speed/cost
```

## Directory Structure

```
llm-evals/
├── README.md                      # This file
├── .gitignore                     # Ignores results/ directory
├── lib/
│   └── NoOpCache.mjs              # No-op cache for testing without DynamoDB
├── generate-eval.mjs              # Script 1: Generate prompts and run models
├── evaluate-results.mjs           # Script 2: Interactive blind evaluation UI
├── test-prompt-generation.mjs     # Test script: Validate prompt generation
├── test-simple-haiku.mjs          # Test script: Quick API connectivity test
└── results/                       # Evaluation results (gitignored)
    └── {timestamp}.json
```

## Results File Format

```json
{
  "timestamp": "2025-10-15T12:34:56.789Z",
  "games": {
    "dota": {
      "match_id": "123456",
      "account_id": "789012",
      "player_name": "PlayerName",
      "prompt": [...],
      "compact_match": {...}
    },
    "deadlock": {...}
  },
  "models": {
    "model_a": "gpt-5",
    "model_b": "claude-sonnet-4-5",
    ...
  },
  "results": [
    {
      "model_id": "model_a",
      "game": "dota",
      "response_time_ms": 1234,
      "tokens": {
        "prompt_tokens": 5000,
        "completion_tokens": 456,
        "cached_tokens": 2000,
        "total_tokens": 5456
      },
      "output": {...},
      "error": null
    }
  ],
  "evaluation": {
    "evaluated_at": "2025-10-15T13:00:00.789Z",
    "comparisons": {...},
    "rankings": {...}
  }
}
```

## Key Features

### No Dependencies
- Uses only standard Node.js `fetch()` - no external HTTP libraries
- No new npm packages required

### Blind Evaluation
- Model identities hidden during comparison
- Randomized display order to avoid position bias
- Prevents evaluator bias

### Elo Rating System
- More sophisticated than simple win/loss counts
- Accounts for relative strength of opponents
- Converges to accurate rankings with fewer comparisons

### Comprehensive Metrics
- **Quality**: User-driven Elo rating
- **Speed**: Response time in milliseconds
- **Cost**: Calculated from token usage and model pricing (per million tokens)
- **Value**: Quality-per-speed and quality-per-cost ratios
- **Efficiency**: Token usage (input/output/cached)

### Reuses Existing Logic
- Imports data fetching from existing handlers
- Uses same prompts as production
- Results directly comparable to live performance

## API Implementation Details

All three providers work with standard `fetch()`:

### OpenAI
- Endpoint: `https://api.openai.com/v1/chat/completions`
- Auth: `Authorization: Bearer {key}`
- JSON response format supported

### Anthropic
- Endpoint: `https://api.anthropic.com/v1/messages`
- Auth: `x-api-key: {key}`
- System prompt separate from messages

### Google Gemini
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Auth: `x-goog-api-key: {key}`
- Different message format (auto-converted)

All APIs support:
- Retry on 429/5xx errors
- Token usage reporting
- JSON output format

## Evaluation Methodology

### Comparison Strategy
- All pairwise combinations of models
- Randomized order to prevent pattern bias
- User can skip ambiguous comparisons
- User can mark outputs as equal quality

### Elo Rating Calculation
- Initial rating: 1500 for all models
- K-factor: 32 (high sensitivity)
- Expected score: `1 / (1 + 10^((RatingB - RatingA) / 400))`
- Rating update: `Rating += K * (Actual - Expected)`

### Quality Metrics
- Summary accuracy and insight depth
- Strength identification (relevant, actionable)
- Weakness analysis (fair, constructive)
- Recommendations (specific, implementable)

## Testing

Before running full evaluations, use these test scripts to verify everything works:

### Quick API Test (Recommended First Step)

```bash
node test-simple-haiku.mjs
```

**What it does:**
- Tests all 8 models with a simple prompt: "Write me a haiku about Dota 2"
- Validates API keys and connectivity for all 3 providers
- Much faster than full match analysis
- Displays speed comparison and token usage
- Saves to `results/haiku-test-{timestamp}.json`
- Can be evaluated with `evaluate-results.mjs`

**Use this when:**
- First-time setup
- Verifying API keys work
- Testing after changing LLMClient code
- Quick connectivity check

### Prompt Generation Test

```bash
node test-prompt-generation.mjs \
  --account-id 789012 \
  [--dota-match-id 123456] \
  [--deadlock-match-id 345678] \
  [--deadlock-player-name PlayerName] \
  [--output prompts.json]
```

**What it does:**
- Fetches match data from APIs (supports both Dota and Deadlock)
- Generates prompts without calling LLMs
- Shows formatted prompt previews and estimated token counts
- Optionally saves full prompts and compact match data to JSON file

**Use this when:**
- Verifying match data is accessible
- Checking prompt structure and content
- Estimating token usage before running full evaluation
- Debugging data fetching issues

### Recommended Testing Workflow

1. **First run** → `test-simple-haiku.mjs` to verify all API keys work
2. **Before full evaluation** → `test-prompt-generation.mjs` to verify match data
3. **Full evaluation** → `generate-eval.mjs` with your match IDs

## Tips for Evaluation

1. **Focus on Quality**: Speed/tokens are measured automatically - focus on comparing output quality
2. **Consider Context**: Judge based on usefulness to the player, not just length
3. **Be Consistent**: Apply same standards across all comparisons
4. **Skip When Uncertain**: Better to skip than guess
5. **Mark Equals**: Don't force a winner if outputs are truly equal

## Troubleshooting

### API Key Issues
- Verify keys in `../environment.js`
- Check key has sufficient quota/credits
- Ensure correct environment variable names

### Rate Limits
- Script includes 1s delay between API calls
- Increase delay in `generate-eval.mjs` if needed
- Run during off-peak hours

### Match Not Found
- Verify match ID is correct
- For Dota: Ensure match is parsed by OpenDota
- For Deadlock: Ensure match data is available
- Run `test-prompt-generation.mjs` to isolate the issue

### Parse Errors
- Check model outputs in results JSON
- Some models may return malformed JSON
- Error details saved in results file

### Testing Issues
- **API fails** → Run `test-simple-haiku.mjs` to verify connectivity
- **Prompt generation fails** → Run `test-prompt-generation.mjs` to see detailed error
- **All models fail** → Check API keys in `environment.js`
