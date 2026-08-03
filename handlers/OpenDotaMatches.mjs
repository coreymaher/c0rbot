"use strict";

// Adapter. OpenDotaMatches.js predates the handlers/ layout and uses a bare
// `module.exports = fn` default export, which NodejsFunction cannot target --
// it needs a named export. Pointing at handler.js instead would pull all 18 of
// its top-level requires (pubg, fortnite, reddit, ...) into the bundle.
import openDotaMatches from "../OpenDotaMatches.js";

export const handler = openDotaMatches;
