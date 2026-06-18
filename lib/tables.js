"use strict";

/**
 * Central accessor for DynamoDB table names.
 *
 * Infrastructure (the CDK stack) is the single source of truth for table
 * names and injects each one as an environment variable. Handlers read them
 * through this module instead of hardcoding string literals, so a rename is a
 * config-only change in CDK and never a code edit.
 *
 * This file is CommonJS so both `.js` (require) and `.mjs` (default import)
 * handlers can consume it:
 *   ESM: import tables from "../lib/tables.js";  tables.cache
 *   CJS: const tables = require("./lib/tables.js");  tables.cache
 */
module.exports = {
  cache: process.env.CACHE_TABLE,
  config: process.env.CONFIG_TABLE,
  matches: process.env.MATCHES_TABLE,
};
