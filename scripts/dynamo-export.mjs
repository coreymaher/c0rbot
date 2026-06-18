#!/usr/bin/env node
"use strict";

/**
 * Export every item of a DynamoDB table to a JSON file (one full scan).
 *
 * Usage:
 *   AWS_PROFILE=c0rbot-admin node scripts/dynamo-export.mjs <table> [outFile]
 *
 * Defaults: region us-east-1, outFile ./<table>.export.json
 * Used during the Serverless -> CDK cutover to snapshot table data before the
 * old stack is torn down. See MIGRATION.md.
 */
import { writeFileSync } from "fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const [table, outFile] = process.argv.slice(2);
if (!table) {
  console.error("Usage: dynamo-export.mjs <table> [outFile]");
  process.exit(1);
}

const region = process.env.AWS_REGION || "us-east-1";
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const out = outFile || `${table}.export.json`;

const items = [];
let ExclusiveStartKey;
do {
  const res = await docClient.send(
    new ScanCommand({ TableName: table, ExclusiveStartKey }),
  );
  items.push(...(res.Items || []));
  ExclusiveStartKey = res.LastEvaluatedKey;
} while (ExclusiveStartKey);

writeFileSync(out, JSON.stringify(items, null, 2));
console.log(`Exported ${items.length} items from "${table}" -> ${out}`);
