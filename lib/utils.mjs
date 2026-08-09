import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// `request` sent no User-Agent and every scrape target accepted it. `fetch` sends
// `node`, so name ourselves rather than let an origin decide what that means.
const USER_AGENT = "c0rbot/1.0 (+https://github.com/coreymaher/c0rbot)";

// Resolves the response body, or `undefined` on any failure -- callers treat a falsy
// result as a transient error and skip the run.
export async function simpleGet(url, { qs, headers, timeout } = {}) {
  const target = qs ? `${url}?${new URLSearchParams(qs)}` : url;

  try {
    const response = await fetch(target, {
      headers: { "User-Agent": USER_AGENT, ...headers },
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    });

    if (!response.ok) {
      console.error(`request error ${url}: HTTP ${response.status}`);
      return undefined;
    }

    return await response.text();
  } catch (err) {
    console.error(`request error ${url}:`);
    console.error(err);
    return undefined;
  }
}

// Nothing in either game's mode and lobby tables starts with a sounded "u",
// which is where picking the article by leading vowel would break ("a user").
export function withArticle(...parts) {
  const phrase = parts.filter(Boolean).join(" ");

  return `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;
}

export async function loadFeedData(key) {
  try {
    const params = {
      TableName: process.env.table,
      Key: { name: key },
    };

    const data = await docClient.send(new GetCommand(params));
    return data;
  } catch (err) {
    console.error("DynamoDB.get error:");
    console.error(err);
    console.error({ TableName: process.env.table, Key: { name: key } });
    return {};
  }
}

export async function updateFeedData(key, feedData) {
  try {
    const params = {
      TableName: process.env.table,
      Item: {
        name: key,
        feed_data: feedData,
        updated_at: Date.now(),
      },
    };

    await docClient.send(new PutCommand(params));
  } catch (err) {
    console.error("DynamoDB.put error:");
    console.error(err);
    console.error({
      TableName: process.env.table,
      Item: { name: key, feed_data: feedData, updated_at: Date.now() },
    });
  }
}
