// @ts-check

const IMAGES = "https://assets-bucket.deadlock-api.com/assets-api-res/images";

/** @param {string} name the hero's internal name, not the display one */
const card = (name) => `${IMAGES}/heroes/${name}_card.png`;
/** @param {string} name */
const small = (name) => `${IMAGES}/heroes/${name}_sm.png`;

// Indexed by hero_id straight off the API, so a hero added since this table was
// last updated is missing. Typed as possibly-undefined to force every caller to
// say what it does about that.
/** @type {Record<number, {name: string, image: string}>} */
export const heroes = {
  1: { name: "Infernus", image: card("inferno") },
  2: { name: "Seven", image: card("gigawatt") },
  3: { name: "Vindicta", image: card("hornet") },
  4: { name: "Lady Geist", image: card("spectre") },
  6: { name: "Abrams", image: card("bull") },
  7: { name: "Wraith", image: card("wraith") },
  8: { name: "McGinnis", image: card("engineer") },
  10: { name: "Paradox", image: card("chrono") },
  11: { name: "Dynamo", image: card("sumo") },
  12: { name: "Kelvin", image: card("kelvin") },
  13: { name: "Haze", image: card("haze") },
  14: { name: "Holliday", image: card("astro") },
  15: { name: "Bebop", image: card("bebop") },
  16: { name: "Calico", image: card("nano") },
  17: { name: "Grey Talon", image: card("archer") },
  18: { name: "Mo & Krill", image: card("digger") },
  19: { name: "Shiv", image: card("shiv") },
  20: { name: "Ivy", image: card("tengu") },
  21: { name: "Kali", image: card("kali") },
  25: { name: "Warden", image: card("warden") },
  27: { name: "Yamato", image: card("yamato") },
  31: { name: "Lash", image: card("lash") },
  35: { name: "Viscous", image: card("viscous") },
  38: { name: "Gunslinger", image: small("gunslinger") },
  39: { name: "The Boss", image: small("yakuza") },
  47: {
    name: "Tokamak",
    image: `${IMAGES}/hud/hero_portraits/tokamak_hud.png`,
  },
  48: { name: "Wrecker", image: card("wrecker") },
  49: { name: "Rutger", image: card("rutger") },
  50: { name: "Pocket", image: card("synth") },
  51: { name: "Thumper", image: small("thumper") },
  52: { name: "Mirage", image: card("mirage") },
  53: { name: "Fathom", image: card("slork") },
  54: { name: "Cadence", image: small("cadence") },
  56: { name: "Bomber", image: "" },
  57: { name: "Shield Guy", image: "" },
  58: { name: "Vyper", image: card("kali") },
  59: { name: "Vandal", image: card("vandal") },
  60: { name: "The Magnificent Sinclair", image: card("magician") },
  61: { name: "Trapper", image: card("trapper") },
  62: { name: "Raven", image: card("operative") },
  63: { name: "Mina", image: card("vampirebat") },
  64: { name: "Drifter", image: card("drifter") },
  65: { name: "Venator", image: card("priest") },
  66: { name: "Victor", image: card("frank") },
  67: { name: "Paige", image: card("bookworm") },
  68: { name: "Boho", image: "" },
  69: { name: "The Doorman", image: card("doorman") },
  70: { name: "Skyrunner", image: card("skyrunner") },
  71: { name: "Swan", image: card("swan") },
  72: { name: "Billy", image: card("punkgoat") },
  73: { name: "Druid", image: card("druid") },
  74: { name: "Graf", image: card("graf") },
  75: { name: "Fortuna", image: card("fortuna") },
  76: { name: "Graves", image: card("necro") },
  77: { name: "Apollo", image: card("fencer") },
  78: { name: "Deadman Danny", image: card("deadpack") },
  79: { name: "Rem", image: card("familiar") },
  80: { name: "Silver", image: card("werewolf") },
  81: { name: "Celeste", image: card("unicorn") },
  84: { name: "Rat King", image: card("ratking") },
  85: { name: "Solomon", image: card("chessmaster") },
  86: { name: "Violet", image: card("artist") },
  87: { name: "Nurse Harrow", image: card("nurse") },
  88: { name: "Baba", image: card("baba") },
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
