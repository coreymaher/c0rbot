const environment = JSON.parse(process.env.environment);

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;

/**
 * @param {{ role: string, content: string}[]} messages
 * @param {string} model
 * @returns {Promise<{output: object, usage: object}>}
 */
async function chatCompletions(messages, model) {
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
          Authorization: `Bearer ${environment.openai.apikey}`,
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

export default { chatCompletions };
