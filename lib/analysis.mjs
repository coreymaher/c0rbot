// @ts-check

/**
 * What the two analysts ask the model for, and how the answer is rendered.
 */

const stringList = { type: "array", items: { type: "string" } };

const properties = {
  summary: { type: "string" },
  earlyGame: { type: "string" },
  midGame: { type: "string" },
  lateGame: { type: "string" },
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
 * When to stop waiting on the model. Lambda's own timeout kills the function
 * before its catch can tell the requester anything, so this stops short of it
 * by enough to post the error.
 *
 * @param {{getRemainingTimeInMillis(): number}} context
 */
export function analysisDeadline(context) {
  return Date.now() + context.getRemainingTimeInMillis() - 10_000;
}

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
 * @property {string} [earlyGame] empty when the match ended before that phase
 * @property {string} [midGame]
 * @property {string} [lateGame]
 * @property {string[]} [strengths]
 * @property {string[]} [weaknesses]
 * @property {string[]} [recommendations]
 */

/**
 * The last line of an analysis embed: which model answered, what it cost, and
 * how long that model took. The time excludes models that failed before it, so
 * it stays comparable across analyses, but includes that model's own retries.
 *
 * @param {{model: string, usage: import("./LLMClient.mjs").Usage, response_time_ms: number}} response
 */
export function analysisFooter({ model, usage, response_time_ms }) {
  const output = usage.completion_tokens + usage.reasoning_tokens;
  return {
    text: `${model} · ${usage.prompt_tokens.toLocaleString("en-US")} in / ${output.toLocaleString("en-US")} out · ${(response_time_ms / 1000).toFixed(1)}s`,
  };
}

// Discord's cap on an embed field's value. A longer one rejects the whole embed.
const FIELD_LIMIT = 1024;

/**
 * @param {string} name
 * @param {string} value
 */
function field(name, value) {
  return {
    name,
    value:
      value.length > FIELD_LIMIT
        ? `${value.slice(0, FIELD_LIMIT - 1)}…`
        : value,
  };
}

/**
 * Discord rejects an embed field with an empty value, which would lose the
 * whole analysis over one section the model left empty -- and a phase the match
 * never reached is left empty by design.
 *
 * @param {Analysis} analysis
 */
export function analysisFields(analysis) {
  const phases = /** @type {[string, string | undefined][]} */ ([
    ["Early game", analysis.earlyGame],
    ["Mid game", analysis.midGame],
    ["Late game", analysis.lateGame],
  ]).flatMap(([name, text]) => (text?.trim() ? [field(name, text)] : []));

  const lists = /** @type {[string, string[] | undefined][]} */ ([
    ["Highlights", analysis.strengths],
    ["Focus areas", analysis.weaknesses],
    ["Recommendations", analysis.recommendations],
  ]).flatMap(([name, items]) =>
    items?.length
      ? [field(name, items.map((txt) => `- ${txt}`).join("\n"))]
      : [],
  );

  return [...phases, ...lists];
}
