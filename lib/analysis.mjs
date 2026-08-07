/**
 * What the two analysts ask for, and who they ask.
 */

/**
 * Output shape both analysts render straight into a Discord embed.
 *
 * Passed to the LLM as a schema so the provider constrains decoding rather than
 * merely being asked for JSON. The prose SCHEMA blocks in DotaMatchProcessor and
 * DeadlockMatchProcessor describe the same shape and must stay in sync -- they
 * carry the per-field semantics and the item/word limits, which JSON Schema
 * cannot express on any of the three providers.
 */
export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "strengths", "weaknesses", "recommendations"],
  additionalProperties: false,
};

/**
 * Tried in order, best first, stepping down when a model is out of quota.
 *
 * Every entry is on the Gemini free tier, which caps each model separately at
 * 20 requests a day -- so a step down is a fresh 20, not a share of one pool.
 * That is the whole point of the chain: the daily cap is the limit we actually
 * hit, and it is per model.
 */
export const ANALYSIS_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
];
