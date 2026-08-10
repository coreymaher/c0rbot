// @ts-check

// The CDK stack is the source of truth for table names and injects each one as an
// environment variable. Handlers read them here rather than hardcoding literals, so a
// rename is a stack change and never a code edit.

/** @param {string} name */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export default {
  cache: required("CACHE_TABLE"),
  config: required("CONFIG_TABLE"),
  matches: required("MATCHES_TABLE"),
};
