"use strict";

// Adapter. OpenDotaMatches.js exports its handler as a bare `module.exports = fn`,
// which NodejsFunction cannot target -- it needs a named export. It is also CommonJS,
// so it cannot await its own config; this file does that and hands it over.
import openDotaMatches from "../OpenDotaMatches.js";
import secrets from "../lib/secrets.mjs";

openDotaMatches.init(await secrets());

export const handler = openDotaMatches;
