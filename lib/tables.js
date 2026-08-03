"use strict";

// The CDK stack is the source of truth for table names and injects each one as an
// environment variable. Handlers read them here rather than hardcoding literals, so a
// rename is a stack change and never a code edit.
//
// CommonJS so both `.js` (require) and `.mjs` (default import) handlers can consume it.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  cache: required("CACHE_TABLE"),
  config: required("CONFIG_TABLE"),
  matches: required("MATCHES_TABLE"),
};
