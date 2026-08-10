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

/**
 * Tried in order, best first, stepping down when a model is out of quota.
 *
 * The Gemini free tier caps each model separately -- 20 requests a day for
 * gemini-2.5-flash -- so a step down is a fresh allowance, not a share of one.
 */
export const ANALYSIS_MODELS = [
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
 * Discord rejects an embed field with an empty value, which would lose the
 * whole analysis over one section the model left empty.
 *
 * @param {Analysis} analysis
 */
export function analysisFields(analysis) {
  /** @type {[string, string[] | undefined][]} */
  const sections = [
    ["Highlights", analysis.strengths],
    ["Focus areas", analysis.weaknesses],
    ["Recommendations", analysis.recommendations],
  ];

  return sections.flatMap(([name, items]) =>
    items?.length
      ? [{ name, value: items.map((txt) => `- ${txt}`).join("\n") }]
      : [],
  );
}
