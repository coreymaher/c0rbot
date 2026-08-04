"use strict";

// Adapter: NodejsFunction needs a named export, and CommonJS cannot use top-level await.
import openDotaMatches from "../OpenDotaMatches.js";
import secrets from "../lib/secrets.mjs";

openDotaMatches.init(await secrets());

export const handler = openDotaMatches;
