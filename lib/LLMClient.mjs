const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;

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
   * @param {Array} messages - Array of {role, content} messages
   * @param {string} model - Model name (e.g., 'gpt-5', 'claude-sonnet-4-5', 'gemini-2.5-flash')
   * @returns {Promise<{output: object, usage: object, response_time_ms: number}>}
   */
  async call(messages, model) {
    const startTime = Date.now();
    const provider = this.#getProviderFromModel(model);

    let result;
    switch (provider) {
      case "openai":
        result = await this.#callOpenAI(model, messages);
        break;
      case "anthropic":
        result = await this.#callAnthropic(model, messages);
        break;
      case "gemini":
        result = await this.#callGemini(model, messages);
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
   * @param {Array} messages - Array of {role, content} messages
   * @returns {Promise<{output: object, usage: object}>}
   */
  async #callOpenAI(model, messages) {
    const body = {
      model,
      messages,
      response_format: { type: "json_object" },
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
          if (res.status === 429 || res.status >= 500) {
            throw new Error(`retryable ${res.status}: ${text}`);
          }
          throw new Error(`OpenAI error ${res.status}: ${text}`);
        }

        const data = await res.json();

        const rawContent = data.choices[0].message.content;

        return {
          output: JSON.parse(rawContent),
          usage: {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
            cached_tokens: data.usage.prompt_tokens_details?.cached_tokens || 0,
            total_tokens: data.usage.total_tokens,
            reasoning_tokens:
              data.usage.completion_tokens_details?.reasoning_tokens || 0,
          },
        };
      } catch (err) {
        console.error(`OpenAI attempt ${attempt + 1} failed:`, err.message);
        lastErr = err;
        attempt += 1;
        if (attempt >= MAX_ATTEMPTS) break;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * attempt)
        );
      }
    }

    throw lastErr;
  }

  /**
   * Call Anthropic Claude API
   * @param {string} model - Model name (e.g., 'claude-sonnet-4-5')
   * @param {Array} messages - Array of {role, content} messages
   * @returns {Promise<{output: object, usage: object}>}
   */
  async #callAnthropic(model, messages) {
    // Extract system message from messages array
    const systemMessage = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    const body = {
      model,
      max_tokens: 4096,
      messages: userMessages,
    };

    if (systemMessage) {
      body.system = systemMessage.content;
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
          if (res.status === 429 || res.status >= 500) {
            throw new Error(`retryable ${res.status}: ${text}`);
          }
          throw new Error(`Anthropic error ${res.status}: ${text}`);
        }

        const data = await res.json();

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
      } catch (err) {
        console.error(`Anthropic attempt ${attempt + 1} failed:`, err.message);
        lastErr = err;
        attempt += 1;
        if (attempt >= MAX_ATTEMPTS) break;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * attempt)
        );
      }
    }

    throw lastErr;
  }

  /**
   * Call Google Gemini API
   * @param {string} model - Model name (e.g., 'gemini-2.5-flash')
   * @param {Array} messages - Array of {role, content} messages
   * @returns {Promise<{output: object, usage: object}>}
   */
  async #callGemini(model, messages) {
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

    const body = {
      contents,
      generationConfig: {
        response_mime_type: "application/json",
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
          if (res.status === 429 || res.status >= 500) {
            throw new Error(`retryable ${res.status}: ${text}`);
          }
          throw new Error(`Gemini error ${res.status}: ${text}`);
        }

        const data = await res.json();

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
      } catch (err) {
        console.error(`Gemini attempt ${attempt + 1} failed:`, err.message);
        lastErr = err;
        attempt += 1;
        if (attempt >= MAX_ATTEMPTS) break;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * attempt)
        );
      }
    }

    throw lastErr;
  }
}
