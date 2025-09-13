const environment = JSON.parse(process.env.environment);

const MAX_ATTEMPTS = 3;

/**
 * @param {{ role: string, content: string}[]} messages
 * @param {string} model
 * @returns {Promise<any>}
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

      return await res.json();
    } catch (err) {
      console.error(err);
      lastErr = err;
      attempt += 1;
      if (attempt >= MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw lastErr;
}

export default { chatCompletions };
