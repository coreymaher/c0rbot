// @ts-check

// Indexed by hero_id straight off the API, so a hero added since this table was
// last updated is missing. Typed as possibly-undefined to force every caller to
// say what it does about that.
/** @type {Record<number, {name: string, image: string}>} */
export const heroes = {
  1: {
    name: "Infernus",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/inferno_card.png",
  },
  2: {
    name: "Seven",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/gigawatt_card.png",
  },
  3: {
    name: "Vindicta",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/hornet_card.png",
  },
  4: {
    name: "Lady Geist",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/spectre_card.png",
  },
  6: {
    name: "Abrams",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/bull_card.png",
  },
  7: {
    name: "Wraith",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/wraith_card.png",
  },
  8: {
    name: "McGinnis",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/engineer_card.png",
  },
  10: {
    name: "Paradox",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/chrono_card.png",
  },
  11: {
    name: "Dynamo",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/sumo_card.png",
  },
  12: {
    name: "Kelvin",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/kelvin_card.png",
  },
  13: {
    name: "Haze",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/haze_card.png",
  },
  14: {
    name: "Holliday",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/astro_card.png",
  },
  15: {
    name: "Bebop",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/bebop_card.png",
  },
  16: {
    name: "Calico",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/nano_card.png",
  },
  17: {
    name: "Grey Talon",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/archer_card.png",
  },
  18: {
    name: "Mo & Krill",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/digger_card.png",
  },
  19: {
    name: "Shiv",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/shiv_card.png",
  },
  20: {
    name: "Ivy",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/tengu_card.png",
  },
  21: {
    name: "Kali",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/kali_card.png",
  },
  25: {
    name: "Warden",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/warden_card.png",
  },
  27: {
    name: "Yamato",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/yamato_card.png",
  },
  31: {
    name: "Lash",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/lash_card.png",
  },
  35: {
    name: "Viscous",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/viscous_card.png",
  },
  38: {
    name: "Gunslinger",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/gunslinger_sm.png",
  },
  39: {
    name: "The Boss",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/yakuza_sm.png",
  },
  47: {
    name: "Tokamak",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/hud/hero_portraits/tokamak_hud.png",
  },
  48: {
    name: "Wrecker",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/wrecker_card.png",
  },
  49: {
    name: "Rutger",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/rutger_card.png",
  },
  50: {
    name: "Pocket",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/synth_card.png",
  },
  51: {
    name: "Thumper",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/thumper_sm.png",
  },
  52: {
    name: "Mirage",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/mirage_card.png",
  },
  53: {
    name: "Fathom",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/slork_card.png",
  },
  54: {
    name: "Cadence",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/cadence_sm.png",
  },
  56: {
    name: "Bomber",
    image: "",
  },
  57: {
    name: "Shield Guy",
    image: "",
  },
  58: {
    name: "Vyper",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/kali_card.png",
  },
  59: {
    name: "Vandal",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/vandal_card.png",
  },
  60: {
    name: "The Magnificent Sinclair",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/magician_card.png",
  },
  61: {
    name: "Trapper",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/trapper_card.png",
  },
  62: {
    name: "Raven",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/operative_card.png",
  },
  63: {
    name: "Mina",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/vampirebat_card.png",
  },
  64: {
    name: "Drifter",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/drifter_card.png",
  },
  65: {
    name: "Venator",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/priest_card.png",
  },
  66: {
    name: "Frank",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/frank_card.png",
  },
  67: {
    name: "Paige",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/bookworm_card.png",
  },
  68: {
    name: "Boho",
    image: "",
  },
  69: {
    name: "The Doorman",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/doorman_card.png",
  },
  70: {
    name: "Skyrunner",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/skyrunner_card.png",
  },
  71: {
    name: "Swan",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/swan_card.png",
  },
  72: {
    name: "Billy",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/punkgoat_card.png",
  },
  73: {
    name: "Druid",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/druid_card.png",
  },
  74: {
    name: "Graf",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/graf_card.png",
  },
  75: {
    name: "Fortuna",
    image:
      "https://assets-bucket.deadlock-api.com/assets-api-res/images/heroes/fortuna_card.png",
  },
};

export const ranks = [
  "Obscurus",
  "Initiate",
  "Seeker",
  "Acolyte",
  "Sentinel",
  "Mystic",
  "Ritualist",
  "Emissary",
  "Oracle",
  "Phantom",
  "Ascendant",
  "Eternus",
];

const badgeValues = ranks.flatMap((_, tier) =>
  tier === 0 ? [] : [1, 2, 3, 4, 5, 6].map((subrank) => tier * 10 + subrank),
);

/**
 * Badges are `tier * 10 + subrank` with subranks 1 to 6, so they are not a
 * number line: the arithmetic mean of 51 and 65 is 58, a rank nobody holds.
 * Averaging index positions lands on a real one, as the Dota handler does.
 *
 * @param {Array<number|null|undefined>} badges
 * @returns {number|null} Null unless at least two badges are known
 */
export function averageBadge(badges) {
  const indexes = badges
    .map((badge) => (badge == null ? -1 : badgeValues.indexOf(badge)))
    .filter((index) => index >= 0);
  if (indexes.length < 2) return null;

  const mean = indexes.reduce((sum, index) => sum + index, 0) / indexes.length;
  return badgeValues[Math.round(mean)] ?? null;
}

/** @type {Record<number, string>} */
export const matchModes = {
  1: "unranked",
  4: "ranked",
};

// Only the modes worth naming; normal reads as a plain "match".
/** @type {Record<number, string>} */
export const gameModes = {
  4: "street brawl",
};

/**
 * Tier 0 is Obscurus, which the rank assets give no subranks: it means unranked,
 * so it formats as nothing rather than as a rank.
 *
 * @param {number|null} badge - `tier * 10 + subrank`
 * @returns {string|null} e.g. "Ritualist 1", or null when there is no rank
 */
export function formatBadge(badge) {
  if (badge == null) return null;

  const tier = Math.floor(badge / 10);
  if (!tier || !ranks[tier]) return null;

  return `${ranks[tier]} ${badge % 10}`;
}
