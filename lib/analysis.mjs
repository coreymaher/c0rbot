// @ts-check

/**
 * What the two analysts ask the model for, and how the answer is rendered.
 */

const stringList = { type: "array", items: { type: "string" } };

const properties = {
  summary: { type: "string" },
  strengths: stringList,
  weaknesses: stringList,
  recommendations: stringList,
};

/**
 * Passed to the LLM so the provider constrains decoding rather than merely
 * being asked for JSON.
 *
 * The prose SCHEMA blocks in the two match processors must stay in sync with
 * this. They also carry the per-field semantics and the item and word limits,
 * which this does not enforce -- models still return four- and five-item lists
 * against a stated limit of three.
 */
export const ANALYSIS_SCHEMA = {
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

// The Gemini free tier caps each model separately, so this is the order to try.
export const ANALYSIS_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
];

/**
 * The model's answer, shaped by ANALYSIS_SCHEMA. The lists are optional here
 * even though the schema requires them, because a model that ignores the
 * schema is the case this module exists to survive.
 *
 * @typedef {object} Analysis
 * @property {string} summary
 * @property {string[]} [strengths]
 * @property {string[]} [weaknesses]
 * @property {string[]} [recommendations]
 */

/**
 * The last line of an analysis embed: which model answered, what it cost, and
 * how long that model took. The time excludes models that failed before it, so
 * it stays comparable across analyses, but includes that model's own retries.
 *
 * @param {{model: string, usage?: import("./LLMClient.mjs").Usage, ms: number}} run
 */
export function analysisFooter({ model, usage, ms }) {
  const parts = [model];
  if (usage) {
    // LLMClient splits reasoning out of completion for every provider, and both are
    // billed as output
    const output = usage.completion_tokens + usage.reasoning_tokens;
    parts.push(
      `${usage.prompt_tokens.toLocaleString("en-US")} in / ${output.toLocaleString("en-US")} out`,
    );
  }
  parts.push(`${(ms / 1000).toFixed(1)}s`);
  return { text: parts.join(" · ") };
}

/**
 * Discord rejects an embed field with an empty value, which would lose the
 * whole analysis over one section the model left empty.
 *
 * @param {Analysis} analysis
 */
export function analysisFields(analysis) {
  return /** @type {[string, string[] | undefined][]} */ ([
    ["Highlights", analysis.strengths],
    ["Focus areas", analysis.weaknesses],
    ["Recommendations", analysis.recommendations],
  ]).flatMap(([name, items]) =>
    items?.length
      ? [{ name, value: items.map((txt) => `- ${txt}`).join("\n") }]
      : [],
  );
}
