"use strict";

module.exports.lobbyTypes = {
  "-1": "Invalid",
  0: "Unranked",
  1: "Practice",
  2: "Tournament",
  3: "Tutorial",
  //4 : "Co-Op with Bots",
  4: "Event",
  5: "Ranked Team MM",
  6: "Solo MM",
  7: "Ranked",
  8: "1v1 Mid",
};

module.exports.gameModes = {
  "-1": "Invalid",
  0: "None",
  1: "All Pick",
  2: "Captain's Mode",
  3: "Random Draft",
  4: "Single Draft",
  5: "All Random",
  6: "Intro",
  7: "Diretide",
  8: "Reverse Captain's Mode",
  9: "The Greeviling",
  10: "Tutorial",
  11: "Mid Only",
  12: "Least Played",
  13: "New Player Pool",
  14: "Compendium Matchmaking",
  15: "Custom",
  16: "Captains Draft",
  17: "Balanced Draft",
  18: "Ability Draft",
  19: "Event",
  20: "All Random Death Match",
  21: "1v1 Solo Mid",
  22: "All Pick",
  23: "Turbo",
  24: "Mutation",
};

module.exports.skillIDs = {
  0: "",
  1: "Normal",
  2: "High",
  3: "Very High",
};

module.exports.heroes = {
  1: {
    name: "Anti-Mage",
    image: "antimage",
  },
  2: {
    name: "Axe",
    image: "axe",
  },
  3: {
    name: "Bane",
    image: "bane",
  },
  4: {
    name: "Bloodseeker",
    image: "bloodseeker",
  },
  5: {
    name: "Crystal Maiden",
    image: "crystal_maiden",
  },
  6: {
    name: "Drow Ranger",
    image: "drow_ranger",
  },
  7: {
    name: "Earthshaker",
    image: "earthshaker",
  },
  8: {
    name: "Juggernaut",
    image: "juggernaut",
  },
  9: {
    name: "Mirana",
    image: "mirana",
  },
  11: {
    name: "Shadow Fiend",
    image: "nevermore",
  },
  10: {
    name: "Morphling",
    image: "morphling",
  },
  12: {
    name: "Phantom Lancer",
    image: "phantom_lancer",
  },
  13: {
    name: "Puck",
    image: "puck",
  },
  14: {
    name: "Pudge",
    image: "pudge",
  },
  15: {
    name: "Razor",
    image: "razor",
  },
  16: {
    name: "Sand King",
    image: "sand_king",
  },
  17: {
    name: "Storm Spirit",
    image: "storm_spirit",
  },
  18: {
    name: "Sven",
    image: "sven",
  },
  19: {
    name: "Tiny",
    image: "tiny",
  },
  20: {
    name: "Vengeful Spirit",
    image: "vengefulspirit",
  },
  21: {
    name: "Windranger",
    image: "windrunner",
  },
  22: {
    name: "Zeus",
    image: "zuus",
  },
  23: {
    name: "Kunkka",
    image: "kunkka",
  },
  25: {
    name: "Lina",
    image: "lina",
  },
  31: {
    name: "Lich",
    image: "lich",
  },
  26: {
    name: "Lion",
    image: "lion",
  },
  27: {
    name: "Shadow Shaman",
    image: "shadow_shaman",
  },
  28: {
    name: "Slardar",
    image: "slardar",
  },
  29: {
    name: "Tidehunter",
    image: "tidehunter",
  },
  30: {
    name: "Witch Doctor",
    image: "witch_doctor",
  },
  32: {
    name: "Riki",
    image: "riki",
  },
  33: {
    name: "Enigma",
    image: "enigma",
  },
  34: {
    name: "Tinker",
    image: "tinker",
  },
  35: {
    name: "Sniper",
    image: "sniper",
  },
  36: {
    name: "Necrophos",
    image: "necrolyte",
  },
  37: {
    name: "Warlock",
    image: "warlock",
  },
  38: {
    name: "Beastmaster",
    image: "beastmaster",
  },
  39: {
    name: "Queen of Pain",
    image: "queenofpain",
  },
  40: {
    name: "Venomancer",
    image: "venomancer",
  },
  41: {
    name: "Faceless Void",
    image: "faceless_void",
  },
  42: {
    name: "Wraith King",
    image: "skeleton_king",
  },
  43: {
    name: "Death Prophet",
    image: "death_prophet",
  },
  44: {
    name: "Phantom Assassin",
    image: "phantom_assassin",
  },
  45: {
    name: "Pugna",
    image: "pugna",
  },
  46: {
    name: "Templar Assassin",
    image: "templar_assassin",
  },
  47: {
    name: "Viper",
    image: "viper",
  },
  48: {
    name: "Luna",
    image: "luna",
  },
  49: {
    name: "Dragon Knight",
    image: "dragon_knight",
  },
  50: {
    name: "Dazzle",
    image: "dazzle",
  },
  51: {
    name: "Clockwerk",
    image: "rattletrap",
  },
  52: {
    name: "Leshrac",
    image: "leshrac",
  },
  53: {
    name: "Nature's Prophet",
    image: "furion",
  },
  54: {
    name: "Lifestealer",
    image: "life_stealer",
  },
  55: {
    name: "Dark Seer",
    image: "dark_seer",
  },
  56: {
    name: "Clinkz",
    image: "clinkz",
  },
  57: {
    name: "Omniknight",
    image: "omniknight",
  },
  58: {
    name: "Enchantress",
    image: "enchantress",
  },
  59: {
    name: "Huskar",
    image: "huskar",
  },
  60: {
    name: "Night Stalker",
    image: "night_stalker",
  },
  61: {
    name: "Broodmother",
    image: "broodmother",
  },
  62: {
    name: "Bounty Hunter",
    image: "bounty_hunter",
  },
  63: {
    name: "Weaver",
    image: "weaver",
  },
  64: {
    name: "Jakiro",
    image: "jakiro",
  },
  65: {
    name: "Batrider",
    image: "batrider",
  },
  66: {
    name: "Chen",
    image: "chen",
  },
  67: {
    name: "Spectre",
    image: "spectre",
  },
  69: {
    name: "Doom",
    image: "doom_bringer",
  },
  68: {
    name: "Ancient Apparition",
    image: "ancient_apparition",
  },
  70: {
    name: "Ursa",
    image: "ursa",
  },
  71: {
    name: "Spirit Breaker",
    image: "spirit_breaker",
  },
  72: {
    name: "Gyrocopter",
    image: "gyrocopter",
  },
  73: {
    name: "Alchemist",
    image: "alchemist",
  },
  74: {
    name: "Invoker",
    image: "invoker",
  },
  75: {
    name: "Silencer",
    image: "silencer",
  },
  76: {
    name: "Outworld Devourer",
    image: "obsidian_destroyer",
  },
  77: {
    name: "Lycan",
    image: "lycan",
  },
  78: {
    name: "Brewmaster",
    image: "brewmaster",
  },
  79: {
    name: "Shadow Demon",
    image: "shadow_demon",
  },
  80: {
    name: "Lone Druid",
    image: "lone_druid",
  },
  81: {
    name: "Chaos Knight",
    image: "chaos_knight",
  },
  82: {
    name: "Meepo",
    image: "meepo",
  },
  83: {
    name: "Treant Protector",
    image: "treant",
  },
  84: {
    name: "Ogre Magi",
    image: "ogre_magi",
  },
  85: {
    name: "Undying",
    image: "undying",
  },
  86: {
    name: "Rubick",
    image: "rubick",
  },
  87: {
    name: "Disruptor",
    image: "disruptor",
  },
  88: {
    name: "Nyx Assassin",
    image: "nyx_assassin",
  },
  89: {
    name: "Naga Siren",
    image: "naga_siren",
  },
  90: {
    name: "Keeper of the Light",
    image: "keeper_of_the_light",
  },
  91: {
    name: "Io",
    image: "wisp",
  },
  92: {
    name: "Visage",
    image: "visage",
  },
  93: {
    name: "Slark",
    image: "slark",
  },
  94: {
    name: "Medusa",
    image: "medusa",
  },
  95: {
    name: "Troll Warlord",
    image: "troll_warlord",
  },
  96: {
    name: "Centaur Warrunner",
    image: "centaur",
  },
  97: {
    name: "Magnus",
    image: "magnataur",
  },
  98: {
    name: "Timbersaw",
    image: "shredder",
  },
  99: {
    name: "Bristleback",
    image: "bristleback",
  },
  100: {
    name: "Tusk",
    image: "tusk",
  },
  101: {
    name: "Skywrath Mage",
    image: "skywrath_mage",
  },
  102: {
    name: "Abaddon",
    image: "abaddon",
  },
  103: {
    name: "Elder Titan",
    image: "elder_titan",
  },
  104: {
    name: "Legion Commander",
    image: "legion_commander",
  },
  106: {
    name: "Ember Spirit",
    image: "ember_spirit",
  },
  107: {
    name: "Earth Spirit",
    image: "earth_spirit",
  },
  108: {
    name: "Underlord",
    image: "abyssal_underlord",
  },
  109: {
    name: "Terrorblade",
    image: "terrorblade",
  },
  110: {
    name: "Phoenix",
    image: "phoenix",
  },
  105: {
    name: "Techies",
    image: "techies",
  },
  111: {
    name: "Oracle",
    image: "oracle",
  },
  112: {
    name: "Winter Wyvern",
    image: "winter_wyvern",
  },
  113: {
    name: "Arc Warden",
    image: "arc_warden",
  },
  114: {
    name: "Monkey King",
    image: "monkey_king",
  },
  119: {
    name: "Dark Willow",
    image: "dark_willow",
  },
  120: {
    name: "Pangolier",
    image: "pangolier",
  },
  121: {
    name: "Grimstroke",
    image: "grimstroke",
  },
  123: {
    name: "Hoodwink",
    image: "hoodwink",
  },
  126: {
    name: "Void Spirit",
    image: "void_spirit",
  },
  128: {
    name: "Snapfire",
    image: "snapfire",
  },
  129: {
    name: "Mars",
    image: "mars",
  },
  131: {
    name: "Ringmaster",
    image: "ringmaster",
  },
  135: {
    name: "Dawnbreaker",
    image: "dawnbreaker",
  },
  136: {
    name: "Marci",
    image: "marci",
  },
  137: {
    name: "Primal Beast",
    image: "primal_beast",
  },
  138: {
    name: "Muerta",
    image: "muerta",
  },
  145: {
    name: "Kez",
    image: "kez",
  },
};

module.exports.rankTiers = {
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

// prettier-ignore
module.exports.rankTierValues = [
  11,
  12,
  13,
  14,
  15,
  21,
  22,
  23,
  24,
  25,
  31,
  32,
  33,
  34,
  35,
  41,
  42,
  43,
  44,
  45,
  51,
  52,
  53,
  54,
  55,
  61,
  62,
  63,
  64,
  65,
  71,
  72,
  73,
  74,
  75,
  80,
];
