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
 * being asked for JSON. The prose SCHEMA blocks in the two match processors
 * describe the same shape and carry the per-field semantics and the item and
 * word limits, which JSON Schema cannot express on any of the three providers.
 */
export const ANALYSIS_SCHEMA = {
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

/**
 * Tried in order, best first, stepping down when a model is out of quota.
 *
 * Every entry is on the Gemini free tier, which caps each model separately at
 * 20 requests a day -- so a step down is a fresh 20, not a share of one pool.
 */
export const ANALYSIS_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
];

/**
 * Discord rejects an embed field with an empty value, which would lose the
 * whole analysis over one section the model left empty.
 */
export function analysisFields(analysis) {
  return [
    ["Highlights", analysis.strengths],
    ["Focus areas", analysis.weaknesses],
    ["Recommendations", analysis.recommendations],
  ]
    .filter(([, items]) => items?.length)
    .map(([name, items]) => ({
      name,
      value: items.map((txt) => `- ${txt}`).join("\n"),
    }));
}
