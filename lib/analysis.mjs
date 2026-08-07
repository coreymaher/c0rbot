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
