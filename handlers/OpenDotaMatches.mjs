"use strict";

// Adapter. OpenDotaMatches.js exports its handler as a bare `module.exports = fn`,
// which NodejsFunction cannot target -- it needs a named export.
import openDotaMatches from "../OpenDotaMatches.js";

export const handler = openDotaMatches;
