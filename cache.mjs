import AWS from "aws-sdk";

const dynamo = new AWS.DynamoDB.DocumentClient();

const TABLE = "cache";
const DEFAULT_TTL = 7 * 24 * 60 * 60;

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * @param {string} namespace
 * @param {string} key
 * @returns {Promise<string>}
 */
async function get(namespace, key) {
  const res = await dynamo
    .get({
      TableName: TABLE,
      Key: { namespace, key },
    })
    .promise();

  const item = res.Item;
  if (!item) return null;

  if (item.expires_at <= nowSec()) return null;

  return item.value;
}

/**
 * @param {string} namespace
 * @param {string} key
 * @param {string} value
 * @param {number} ttl
 * @returns {Promise<void>}
 */
async function set(namespace, key, value, ttl = DEFAULT_TTL) {
  const now = nowSec();

  await dynamo
    .put({
      TableName: TABLE,
      Item: {
        namespace,
        key,
        value,
        created_at: now,
        expires_at: now + ttl,
      },
    })
    .promise();
}

export default { get, set };
