// Per million tokens, as of August 2026. Source: provider pricing pages.
const PRICING = {
  "gpt-5": { input: 2.5, output: 10.0 },
  "gpt-5-mini": { input: 0.4, output: 1.6 },
  "gpt-5-nano": { input: 0.1, output: 0.4 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "claude-opus-4-1": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 1.5, output: 7.5 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
};

export function isPriced(model) {
  return Boolean(PRICING[model]);
}

/**
 * Cost in USD, or null when the model has no published price -- which reads
 * differently from a genuine zero when it reaches an average.
 */
export function calculateCost(model, tokens) {
  const pricing = PRICING[model];
  if (!pricing || !tokens) {
    return null;
  }

  // Thinking tokens bill as output. LLMClient reports them separately from
  // completion_tokens on every provider, so the two always add.
  const outputTokens =
    tokens.completion_tokens + (tokens.reasoning_tokens || 0);

  return (
    (tokens.prompt_tokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}
