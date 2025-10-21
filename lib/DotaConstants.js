"use strict";

// Import from dotaconstants package for heroes and game modes
const heroesData = require("dotaconstants/build/heroes.json");
const gameModesData = require("dotaconstants/build/game_mode.json");

// Transform heroes from dotaconstants format to our API
// Package: { "1": { id: 1, localized_name: "Anti-Mage", name: "npc_dota_hero_antimage", icon: "..." } }
// Our API: { 1: { name: "Anti-Mage", image: "antimage", raw_name: "npc_dota_hero_antimage" } }
const heroes = {};
for (const [id, hero] of Object.entries(heroesData)) {
  // Extract image name from icon path: "/apps/dota2/images/dota_react/heroes/icons/antimage.png?"
  const imageName = hero.icon
    ? hero.icon.split("/").pop().replace(".png?", "")
    : hero.name.replace("npc_dota_hero_", "");

  heroes[id] = {
    name: hero.localized_name,
    image: imageName,
    raw_name: hero.name,
  };
}

// Transform game modes from dotaconstants format to our API
// Package: { "18": { id: 18, name: "game_mode_ability_draft" } }
// Our API: { 18: "Ability Draft" }
const gameModes = {};
for (const [id, mode] of Object.entries(gameModesData)) {
  // Transform "game_mode_ability_draft" to "Ability Draft"
  const displayName = mode.name
    .replace("game_mode_", "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  gameModes[id] = displayName;
}

// Manual override for some modes that don't transform well
gameModes["-1"] = "Invalid";
gameModes["0"] = "None";
gameModes["1"] = "All Pick";
gameModes["2"] = "Captain's Mode";
gameModes["8"] = "Reverse Captain's Mode";
gameModes["9"] = "The Greeviling";
gameModes["13"] = "New Player Pool";
gameModes["14"] = "Compendium Matchmaking";
gameModes["20"] = "All Random Death Match";
gameModes["21"] = "1v1 Solo Mid";
gameModes["22"] = "All Pick";

// Lobby types - custom definitions (package names are too generic)
const lobbyTypes = {
  "-1": "Invalid",
  0: "Unranked",
  1: "Practice",
  2: "Tournament",
  3: "Tutorial",
  4: "Event",
  5: "Ranked Team MM",
  6: "Solo MM",
  7: "Ranked",
  8: "1v1 Mid",
};

// Custom constants not available in dotaconstants package
const skillIDs = {
  0: "",
  1: "Normal",
  2: "High",
  3: "Very High",
};

const rankTiers = {
  0: "Uncalibrated",
  1: "Herald",
  2: "Guardian",
  3: "Crusader",
  4: "Archon",
  5: "Legend",
  6: "Ancient",
  7: "Divine",
  8: "Immortal",
};

// Valid rank tier values in order from lowest to highest.
// Used to calculate average rank across players by converting to index position.
// prettier-ignore
const rankTierValues = [
  11, 12, 13, 14, 15,  // Herald 1-5
  21, 22, 23, 24, 25,  // Guardian 1-5
  31, 32, 33, 34, 35,  // Crusader 1-5
  41, 42, 43, 44, 45,  // Archon 1-5
  51, 52, 53, 54, 55,  // Legend 1-5
  61, 62, 63, 64, 65,  // Ancient 1-5
  71, 72, 73, 74, 75,  // Divine 1-5
  80,                  // Immortal (no sub-tier)
];

module.exports.lobbyTypes = lobbyTypes;
module.exports.gameModes = gameModes;
module.exports.skillIDs = skillIDs;
module.exports.heroes = heroes;
module.exports.rankTiers = rankTiers;
module.exports.rankTierValues = rankTierValues;
