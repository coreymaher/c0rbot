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

// Discord's caps. Past any one of them it rejects the whole embed.
const EMBED_LIMIT = 6_000;
const DESCRIPTION_LIMIT = 4096;
const FIELD_LIMIT = 1024;
const TITLE_LIMIT = 256;

/**
 * @param {string} text
 * @param {number} limit
 */
function cut(text, limit) {
  if (text.length <= limit) return text;
  let end = Math.max(0, limit - 1);
  // A cut between the halves of a surrogate pair leaves an unpaired one.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${text.slice(0, end)}…`;
}

/**
 * Discord rejects an embed field with an empty value, which would lose the
 * whole analysis over one section the model left empty -- and a phase the match
 * never reached is left empty by design.
 *
 * @param {Analysis} analysis
 */
function analysisFields(analysis) {
  const phases = /** @type {[string, string | undefined][]} */ ([
    ["Early game", analysis.earlyGame],
    ["Mid game", analysis.midGame],
    ["Late game", analysis.lateGame],
  ]).flatMap(([name, text]) => (text?.trim() ? [{ name, value: text }] : []));

  const lists = /** @type {[string, string[] | undefined][]} */ ([
    ["Highlights", analysis.strengths],
    ["Focus areas", analysis.weaknesses],
    ["Recommendations", analysis.recommendations],
  ]).flatMap(([name, items]) =>
    items?.length
      ? [{ name, value: items.map((txt) => `- ${txt}`).join("\n") }]
      : [],
  );

  return [...phases, ...lists].map(({ name, value }) => ({
    name,
    value: cut(value, FIELD_LIMIT),
  }));
}

/**
 * The analysis as one Discord embed. The word limits in the prompts keep it
 * well inside Discord's caps, but models overrun them, and a single overrun
 * would cost the whole analysis. Over the total, every text is cut to one shared
 * length, the longest that fits, so the shorter sections stay whole and no one
 * section loses everything.
 *
 * @param {string} title
 * @param {Analysis} analysis
 * @param {{text: string}} footer
 */
export function analysisEmbed(title, analysis, footer) {
  const texts = [
    { value: cut(analysis.summary ?? "", DESCRIPTION_LIMIT) },
    ...analysisFields(analysis),
  ];
  const names = texts.reduce(
    (sum, text) => sum + ("name" in text ? text.name.length : 0),
    0,
  );
  let budget =
    EMBED_LIMIT -
    Math.min(title.length, TITLE_LIMIT) -
    footer.text.length -
    names;

  // Shortest first: each text that fits under an even share of what is left
  // keeps its length, and the first that does not sets the cap for the rest.
  const lengths = texts.map((text) => text.value.length).sort((a, b) => a - b);
  for (const [i, length] of lengths.entries()) {
    const share = Math.floor(budget / (lengths.length - i));
    if (length > share) {
      for (const text of texts) text.value = cut(text.value, share);
      break;
    }
    budget -= length;
  }

  const [description, ...fields] = texts;
  return {
    title: cut(title, TITLE_LIMIT),
    description: description?.value,
    fields: /** @type {{name: string, value: string}[]} */ (fields),
    footer,
  };
}
