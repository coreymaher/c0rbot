"use strict";

// Adapter. OpenDotaMatches.js exports its handler as a bare `module.exports = fn`, which
// NodejsFunction cannot target -- it needs a named export. It is also CommonJS, which
// esbuild wraps in a closure that cannot use top-level await, so it cannot fetch its own
// config; this file awaits it and hands it over.
import openDotaMatches from "../OpenDotaMatches.js";
import secrets from "../lib/secrets.mjs";

openDotaMatches.init(await secrets());

export const handler = openDotaMatches;
