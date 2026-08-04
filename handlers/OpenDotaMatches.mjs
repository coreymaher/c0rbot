"use strict";

// Adapter. OpenDotaMatches.js exports a bare `module.exports = fn`, which NodejsFunction
// cannot target -- it needs a named export -- and being CommonJS it cannot use top-level
// await, so this file fetches the config for it.
import openDotaMatches from "../OpenDotaMatches.js";
import secrets from "../lib/secrets.mjs";

openDotaMatches.init(await secrets());

export const handler = openDotaMatches;
