import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

const TABLE = "cache";
const DEFAULT_TTL = 7 * 24 * 60 * 60;

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * @param {string} namespace
 * @param {string} key
 * @returns {Promise<string>}
 */
async function get(namespace, key) {
  const res = await dynamo.send(
    new GetCommand({
      TableName: TABLE,
      Key: { namespace, key },
    }),
  );

  const item = res.Item;
  if (!item) return null;

  if (item.expires_at <= nowSec()) return null;

  // Decompress if compressed
  if (item.compressed) {
    const buffer = Buffer.from(item.value, "base64");
    const decompressed = await gunzipAsync(buffer);
    return decompressed.toString("utf-8");
  }

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

  // Compress value with gzip and encode as base64
  const compressed = await gzipAsync(Buffer.from(value, "utf-8"));
  const compressedValue = compressed.toString("base64");

  const uncompressedSize = value.length;
  const compressedSize = compressedValue.length;
  console.log(`Cache set [${namespace}:${key}] - Uncompressed: ${(uncompressedSize / 1024).toFixed(2)} KB, Compressed: ${(compressedSize / 1024).toFixed(2)} KB (${((compressedSize / uncompressedSize) * 100).toFixed(1)}%)`);

  await dynamo.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        namespace,
        key,
        value: compressedValue,
        compressed: true,
        created_at: now,
        expires_at: now + ttl,
      },
    }),
  );
}

export default { get, set };
