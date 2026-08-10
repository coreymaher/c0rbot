// @ts-check

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;

/**
 * The flags are absent on anything that is not a provider HTTP failure -- a
 * bug in this file, or an aborted request -- and both reads treat that as
 * "do not retry, do not step down".
 *
 * @typedef {Error & {status?: number, retryable?: boolean, tryNextModel?: boolean}} ProviderError
 */

/**
 * A chat message as the callers build them, not as any provider returns them.
 * @typedef {{role: string, content: string}} Message
 */

/**
 * Normalised across the three providers, so prompt + completion + reasoning is
 * the total on all of them. None of them reports it that way natively.
 *
 * @typedef {object} Usage
 * @property {number} prompt_tokens
 * @property {number} completion_tokens
 * @property {number} cached_tokens
 * @property {number} reasoning_tokens
 * @property {number} total_tokens
 */

/**
 * Classifies a provider's HTTP failure along two independent axes.
 *
 * `retryable` -- worth asking this same model again. Only a 5xx qualifies.
 * Answering a 429 that asked for a 30s delay with a 300ms backoff cannot
 * succeed, and the rest of the 4xx range is rejected identically every time.
 *
 * `tryNextModel` -- worth asking a different model. Rate limits qualify because
 * the caps are per model, and so does a 404: providers retire models, and a
 * stale name in a fallback chain must not take down the models below it.
 *
 * @param {string} provider
 * @param {number} status
 * @param {string} text
 * @returns {ProviderError}
 */
function providerError(provider, status, text) {
  /** @type {ProviderError} */
  const err = new Error(`${provider} error ${status}: ${text}`);
  err.status = status;
  err.retryable = status >= 500;
  err.tryNextModel = status === 429 || status === 404 || status >= 500;
  return err;
}

/**
 * Unified LLM client for OpenAI, Anthropic, and Google Gemini
 * All methods use standard fetch() - no external dependencies
 */
export default class LLMClient {
  /**
   * @param {Object} apiKeys - API keys for each provider
   * @param {string} apiKeys.openai - OpenAI API key
   * @param {string} apiKeys.anthropic - Anthropic API key
   * @param {string} apiKeys.gemini - Google Gemini API key
   */
  constructor(apiKeys) {
    this.apiKeys = apiKeys;
  }

  /**
   * Call a model from any provider (auto-detects provider from model name)
   * @param {Message[]} messages
   * @param {string} model - Model name (e.g., 'gpt-5', 'claude-sonnet-4-5', 'gemini-2.5-flash')
   * @param {object} [schema] - JSON Schema to constrain the output. All three
   *   providers accept the same standard schema; only where it goes in the
   *   request body differs. Must set `additionalProperties: false` and list
   *   every property in `required`, which OpenAI's strict mode demands and the
   *   other two tolerate. Without a schema the model is asked for JSON but not
   *   held to it, and some emit a duplicated closing brace or a code fence.
   * @returns {Promise<{output: any, usage: Usage, response_time_ms: number}>}
   *   `output` is the model's JSON: schema-constrained, but never verified here
   */
  async call(messages, model, schema) {
    const startTime = Date.now();
    const provider = this.#getProviderFromModel(model);

    let result;
    switch (provider) {
      case "openai":
        result = await this.#callOpenAI(model, messages, schema);
        break;
      case "anthropic":
        result = await this.#callAnthropic(model, messages, schema);
        break;
      case "gemini":
        result = await this.#callGemini(model, messages, schema);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    const response_time_ms = Date.now() - startTime;

    return {
      ...result,
      response_time_ms,
    };
  }

  /**
   * Call the first model that answers, stepping down on rate limits, provider
   * blips, and models that no longer exist. A rejected schema or a malformed
   * prompt does not step down: it fails identically on every model, so walking
   * the chain would return the same error more slowly.
   *
   * @param {Message[]} messages
   * @param {string[]} models - Models to try, best first
   * @param {object} [schema] - JSON Schema to constrain the output
   * @returns {Promise<{output: any, usage: Usage, response_time_ms: number, model: string}>}
   *   `model` is the one that actually answered, which is not always models[0]
   */
  async callWithFallback(messages, models, schema) {
    if (!models?.length) {
      throw new Error("callWithFallback requires at least one model");
    }

    let lastErr;

    for (const model of models) {
      try {
        const result = await this.call(messages, model, schema);
        return { ...result, model };
      } catch (rawErr) {
        const err = /** @type {ProviderError} */ (rawErr);
        if (!err.tryNextModel) throw err;
        lastErr = err;
        console.warn(
          `${model} unavailable, falling back:`,
          err.message.slice(0, 160),
        );
      }
    }

    throw lastErr;
  }

  /**
   * Determine provider from model name
   * @param {string} model - Model name
   * @returns {string} - Provider name
   */
  #getProviderFromModel(model) {
    if (model.startsWith("gpt-")) return "openai";
    if (model.startsWith("claude-")) return "anthropic";
    if (model.startsWith("gemini-")) return "gemini";
    throw new Error(`Cannot determine provider for model: ${model}`);
  }

  /**
   * Call OpenAI API
   * @param {string} model - Model name (e.g., 'gpt-5')
   * @param {Message[]} messages
   * @param {object} [schema] - JSON Schema to constrain the output
   * @returns {Promise<{output: any, usage: Usage}>}
   */
  async #callOpenAI(model, messages, schema) {
    const body = {
      model,
      messages,
      response_format: schema
        ? {
            type: "json_schema",
            json_schema: { name: "output", strict: true, schema },
          }
        : { type: "json_object" },
    };

    let attempt = 0;
    let lastErr;

    while (attempt < MAX_ATTEMPTS) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKeys.openai}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw providerError("OpenAI", res.status, text);
        }

        // Provider response bodies are not modelled: each one is a distinct
        // shape that only this method reads, and only to build `usage`.
        const data = /** @type {any} */ (await res.json());

        const rawContent = data.choices[0].message.content;

        // OpenAI counts reasoning inside completion_tokens, where Gemini and
        // Anthropic report it alongside. Subtracting it makes prompt +
        // completion + reasoning the total on all three, so a caller can add
        // the two without knowing which provider answered.
        const reasoningTokens =
          data.usage.completion_tokens_details?.reasoning_tokens || 0;

        return {
          output: JSON.parse(rawContent),
          usage: {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens - reasoningTokens,
            cached_tokens: data.usage.prompt_tokens_details?.cached_tokens || 0,
            total_tokens: data.usage.total_tokens,
            reasoning_tokens: reasoningTokens,
          },
        };
      } catch (rawErr) {
        const err = /** @type {ProviderError} */ (rawErr);
        console.error(`OpenAI attempt ${attempt + 1} failed:`, err.message);
        lastErr = err;
        if (err.status && !err.retryable) break;
        attempt += 1;
        if (attempt >= MAX_ATTEMPTS) break;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * attempt),
        );
      }
    }

    throw lastErr;
  }

  /**
   * Call Anthropic Claude API
   * @param {string} model - Model name (e.g., 'claude-sonnet-4-5')
   * @param {Message[]} messages
   * @param {object} [schema] - JSON Schema to constrain the output
   * @returns {Promise<{output: any, usage: Usage}>}
   */
  async #callAnthropic(model, messages, schema) {
    // Extract system message from messages array
    const systemMessage = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    // Open-ended: the two conditional fields below are set after construction.
    /** @type {Record<string, any>} */
    const body = {
      model,
      max_tokens: 4096,
      messages: userMessages,
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    if (schema) {
      body.output_config = { format: { type: "json_schema", schema } };
    }

    let attempt = 0;
    let lastErr;

    while (attempt < MAX_ATTEMPTS) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": this.apiKeys.anthropic,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw providerError("Anthropic", res.status, text);
        }

        // Provider response bodies are not modelled: each one is a distinct
        // shape that only this method reads, and only to build `usage`.
        const data = /** @type {any} */ (await res.json());

        // Claude returns text content, need to parse JSON
        let contentText = data.content[0].text;

        // Strip markdown code fences if present
        contentText = contentText
          .replace(/^```(?:json)?\s*\n?/g, "")
          .replace(/\n?```\s*$/g, "")
          .trim();

        const output = JSON.parse(contentText);

        return {
          output,
          usage: {
            prompt_tokens: data.usage.input_tokens,
            completion_tokens: data.usage.output_tokens,
            cached_tokens: data.usage.cache_read_input_tokens || 0,
            reasoning_tokens: 0, // Anthropic doesn't expose thinking tokens in standard usage (requires extended thinking mode)
            total_tokens:
              data.usage.input_tokens +
              data.usage.output_tokens +
              (data.usage.cache_creation_input_tokens || 0),
          },
        };
      } catch (rawErr) {
        const err = /** @type {ProviderError} */ (rawErr);
        console.error(`Anthropic attempt ${attempt + 1} failed:`, err.message);
        lastErr = err;
        if (err.status && !err.retryable) break;
        attempt += 1;
        if (attempt >= MAX_ATTEMPTS) break;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * attempt),
        );
      }
    }

    throw lastErr;
  }

  /**
   * Call Google Gemini API
   * @param {string} model - Model name (e.g., 'gemini-2.5-flash')
   * @param {Message[]} messages
   * @param {object} [schema] - JSON Schema to constrain the output
   * @returns {Promise<{output: any, usage: Usage}>}
   */
  async #callGemini(model, messages, schema) {
    // Gemini has a different message format
    // System messages are sent as system_instruction
    // User/assistant messages are converted to contents array

    const systemMessage = messages.find((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    // Convert messages to Gemini format
    const contents = conversationMessages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    // Open-ended: system_instruction is set after construction.
    /** @type {Record<string, any>} */
    const body = {
      contents,
      generationConfig: {
        response_mime_type: "application/json",
        // Not response_schema: that field is an OpenAPI subset and rejects
        // additionalProperties, which OpenAI's strict mode requires.
        ...(schema && { response_json_schema: schema }),
      },
    };

    if (systemMessage) {
      body.system_instruction = {
        parts: [{ text: systemMessage.content }],
      };
    }

    let attempt = 0;
    let lastErr;

    while (attempt < MAX_ATTEMPTS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "x-goog-api-key": this.apiKeys.gemini,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw providerError("Gemini", res.status, text);
        }

        // Provider response bodies are not modelled: each one is a distinct
        // shape that only this method reads, and only to build `usage`.
        const data = /** @type {any} */ (await res.json());

        // Parse the JSON response from Gemini
        let contentText = data.candidates[0].content.parts[0].text;

        // Strip markdown code fences if present
        contentText = contentText
          .replace(/^```(?:json)?\s*\n?/g, "")
          .replace(/\n?```\s*$/g, "")
          .trim();

        const output = JSON.parse(contentText);

        // Gemini's token usage is in usageMetadata
        const usage = data.usageMetadata || {};

        return {
          output,
          usage: {
            prompt_tokens: usage.promptTokenCount || 0,
            completion_tokens: usage.candidatesTokenCount || 0,
            cached_tokens: usage.cachedContentTokenCount || 0,
            reasoning_tokens: usage.thoughtsTokenCount || 0, // Gemini thinking tokens
            total_tokens: usage.totalTokenCount || 0,
          },
        };
      } catch (rawErr) {
        const err = /** @type {ProviderError} */ (rawErr);
        console.error(`Gemini attempt ${attempt + 1} failed:`, err.message);
        lastErr = err;
        if (err.status && !err.retryable) break;
        attempt += 1;
        if (attempt >= MAX_ATTEMPTS) break;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * attempt),
        );
      }
    }

    throw lastErr;
  }
}
