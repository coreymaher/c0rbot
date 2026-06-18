#!/usr/bin/env node
"use strict";

/**
 * Import items from a JSON export (see dynamo-export.mjs) into a DynamoDB table
 * using BatchWrite (25 items per request).
 *
 * Usage:
 *   AWS_PROFILE=c0rbot-admin node scripts/dynamo-import.mjs <table> <inFile>
 *
 * Defaults: region us-east-1. Used during the Serverless -> CDK cutover to
 * restore snapshotted data into the freshly created CDK tables. See MIGRATION.md.
 */
import { readFileSync } from "fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const [table, inFile] = process.argv.slice(2);
if (!table || !inFile) {
  console.error("Usage: dynamo-import.mjs <table> <inFile>");
  process.exit(1);
}

const region = process.env.AWS_REGION || "us-east-1";
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const items = JSON.parse(readFileSync(inFile, "utf8"));
if (!Array.isArray(items)) {
  console.error(`${inFile} did not contain a JSON array of items`);
  process.exit(1);
}

let written = 0;
for (let i = 0; i < items.length; i += 25) {
  const batch = items.slice(i, i + 25);
  let RequestItems = {
    [table]: batch.map((Item) => ({ PutRequest: { Item } })),
  };
  // Retry unprocessed items (throttling) with simple backoff.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await docClient.send(new BatchWriteCommand({ RequestItems }));
    const unprocessed = res.UnprocessedItems?.[table] || [];
    if (unprocessed.length === 0) break;
    RequestItems = { [table]: unprocessed };
    await new Promise((r) => setTimeout(r, 2 ** attempt * 200));
  }
  written += batch.length;
  console.log(`  ${written}/${items.length}`);
}

console.log(`Imported ${written} items into "${table}"`);
