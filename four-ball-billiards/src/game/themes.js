// src/game/themes.js
// The five tables.
//
// A theme is a PALETTE plus at most one structural change, and that limit
// is the whole design of this file: every look here is reachable from the
// one table renderer, so adding a sixth is a data entry rather than a
// second painter to keep in step with the first.
//
// Each carries its own cue as well as its own cloth. A blackened butt
// belongs with steel rails and a rosewood one with mahogany; letting the
// cue drift out of step with the table is the fastest way to make a
// careful table look like a stock asset.
//
// UNLOCKS are counted in stages cleared, and the numbers are absolute
// rather than a fraction of the campaign. A fraction would RE-LOCK a
// table the day the campaign grows, which is the one thing a cosmetic
// reward must never do.

/** The four gradients that make an American-style cue: maple, brass,
 * rosewood, Irish linen. Kept as the base because three of the five
 * themes want some of it. */
const CUE_CLASSIC = {
  shaft: [[0, "#8a6a3e"], [0.16, "#e8cfa2"], [0.34, "#fbf0d8"], [0.62, "#dcc094"], [1, "#7d5e35"]],
  butt: [[0, "#1b0d07"], [0.18, "#5c2d18"], [0.34, "#8a4526"], [0.62, "#4a2413"], [1, "#160a05"]],
  wrap: [[0, "#12100e"], [0.2, "#3a352f"], [0.36, "#565049"], [0.62, "#2c2823"], [1, "#0e0c0a"]],
  collar: [[0, "#6b5320"], [0.3, "#d8b45c"], [0.5, "#f4e3ac"], [0.75, "#a8873c"], [1, "#4a3814"]],
  ferrule: [[0, "#b9ac96"], [0.3, "#f7f3e8"], [0.6, "#efe8d8"], [1, "#9a927f"]],
  tip: [[0, "#123a5c"], [0.35, "#2f6ea8"], [0.7, "#2a5f92"], [1, "#0d2942"]],
  grain: "#7a5a32",
};

/** Pale ash, an ebony collar, a rosewood butt, no wrap and a leather tip
 * — the cue a European carom player actually holds. */
const CUE_FRENCH = {
  ...CUE_CLASSIC,
  shaft: [[0, "#9a8253"], [0.16, "#f0e0bd"], [0.34, "#fdf6e6"], [0.62, "#e6d4ad"], [1, "#8b7548"]],
  butt: [[0, "#140b06"], [0.18, "#43210f"], [0.34, "#6b3418"], [0.62, "#361a0c"], [1, "#0e0704"]],
  wrap: [[0, "#140b06"], [0.2, "#3d1e0e"], [0.36, "#5e2e15"], [0.62, "#31170b"], [1, "#0d0603"]],
  collar: [[0, "#0b0a09"], [0.3, "#2a2724"], [0.5, "#3d3936"], [0.75, "#1a1817"], [1, "#070606"]],
  tip: [[0, "#2a1c10"], [0.35, "#6b4a2c"], [0.7, "#5c3f25"], [1, "#22160c"]],
  grain: "#8a6a3e",
};

/** Matte black butt, polished brass joint, near-white shaft. The only cue
 * here that does not look borrowed from another game on a dark rail. */
const CUE_BLACK = {
  ...CUE_CLASSIC,
  shaft: [[0, "#8f8471"], [0.16, "#e6ded0"], [0.34, "#f7f2e8"], [0.62, "#d5cbba"], [1, "#7d7462"]],
  butt: [[0, "#080909"], [0.18, "#1e2124"], [0.34, "#2e3236"], [0.62, "#191c1f"], [1, "#060707"]],
  wrap: [[0, "#070808"], [0.2, "#191c1e"], [0.36, "#26292c"], [0.62, "#141618"], [1, "#050606"]],
  grain: "rgba(0,0,0,0)",
};

/** One pale tapered stick and a blue tip. An instrument, not a prop. */
const PALE = [[0, "#9d947f"], [0.16, "#ece5d6"], [0.34, "#fbf7ee"], [0.62, "#ded6c5"], [1, "#8d8471"]];
const CUE_MINIMAL = {
  ...CUE_CLASSIC,
  shaft: PALE,
  butt: PALE,
  wrap: PALE,
  collar: PALE,
  grain: "rgba(0,0,0,0)",
};

/** How a sight is inlaid: the routed seam it sits in, the four stops
 * across its face, and the glint on the lit corner. */
const SIGHT_PEARL = {
  seam: "rgba(24,12,4,0.55)",
  stops: ["#fffaf0", "#efe3cd", "#dcd3e2", "#c9bda6"],
  glint: "rgba(255,255,255,0.75)",
};
const SIGHT_IVORY = {
  seam: "rgba(30,16,4,0.6)",
  stops: ["#f6ead0", "#e6d3a8", "#d8c79f", "#b8a577"],
  glint: "rgba(255,246,222,0.6)",
};
const SIGHT_BRASS = {
  seam: "rgba(8,10,11,0.7)",
  stops: ["#f0d79a", "#d3ab5c", "#b08d45", "#7d6329"],
  glint: "rgba(255,240,200,0.65)",
};
const SIGHT_DIM = {
  seam: "rgba(0,0,0,0.5)",
  stops: ["#aab3b8", "#8b959b", "#727c82", "#596267"],
  glint: "rgba(255,255,255,0.35)",
};

export const THEMES = [
  {
    id: "simonis",
    name: "Simonis Blue",
    // The cloth every three-cushion match on European television is
    // played on. Two reasons it is the default and neither is taste: the
    // audience is European and carom is a European sport there, so this
    // reads as the real thing to the people most likely to recognise it;
    // and red on green is the classic complementary vibration where red
    // on blue-teal is not, so the balls simply separate better.
    blurb: "The cloth European three-cushion is played on. Near-black walnut, nickel fillet.",
    unlockAt: 0,
    colors: {
      cloth: "#26707d", clothLamp: "#35909f", clothDark: "#123f4a", clothLine: "#37909e",
      cushion: "#1a5b68", rail: "#2a211d", railLight: "#4b3a30", railDark: "#120d0b",
    },
    rails: "wood",
    fillet: "rgba(186,194,199,0.62)",
    lamp: 0.12,
    vignette: 0.2,
    sight: SIGHT_PEARL,
    cue: CUE_BLACK,
  },
  {
    id: "tournament",
    name: "Tournament Green",
    blurb: "Bright match cloth, deep mahogany, a brass fillet at the cushion.",
    unlockAt: 10,
    colors: {
      cloth: "#2c8763", clothLamp: "#3daa7c", clothDark: "#14543f", clothLine: "#43a37f",
      cushion: "#1c6a4d", rail: "#4a2a17", railLight: "#7d4827", railDark: "#200f06",
    },
    rails: "wood",
    fillet: "rgba(201,164,92,0.8)",
    lamp: 0.15,
    vignette: 0.18,
    sight: SIGHT_PEARL,
    cue: CUE_CLASSIC,
  },
  {
    id: "cafe",
    name: "Cafe Billard",
    blurb: "One hanging lamp, olive cloth, aged walnut. The corners fall into shadow.",
    unlockAt: 25,
    colors: {
      cloth: "#33704b", clothLamp: "#519a6a", clothDark: "#12331f", clothLine: "#3d7d55",
      cushion: "#24573b", rail: "#5b3a22", railLight: "#8b6038", railDark: "#26160c",
    },
    rails: "wood",
    fillet: "rgba(176,139,66,0.85)",
    // Softer than it was drawn in the pitch. At 0.42 on a phone, where
    // the table fills the screen, the pool stopped reading as a lamp in a
    // dark room and started reading as a washed-out middle - and the
    // corners it darkened are where the awkward positions live.
    lamp: 0.32,
    vignette: 0.34,
    warm: "rgba(255,196,120,0.09)",
    sight: SIGHT_IVORY,
    cue: CUE_FRENCH,
  },
  {
    id: "slate",
    name: "Slate & Brass",
    blurb: "No wood. Charcoal cloth, blackened steel, one brass line round the whole table.",
    unlockAt: 45,
    colors: {
      cloth: "#39433f", clothLamp: "#4c5854", clothDark: "#222927", clothLine: "#4b5551",
      cushion: "#2b3330", rail: "#2e3336", railLight: "#5b6367", railDark: "#15181a",
    },
    rails: "steel",
    inlay: "#c9a45c",
    lamp: 0.14,
    vignette: 0.22,
    sight: SIGHT_BRASS,
    cue: CUE_BLACK,
  },
  {
    id: "studio",
    name: "Studio Minimal",
    blurb: "A thin dark bezel and a flat bed. Survives being shrunk to a thumbnail.",
    unlockAt: 70,
    colors: {
      cloth: "#2f8060", clothLamp: "#36906d", clothDark: "#1d6349", clothLine: "#3a9270",
      cushion: "#256a51", rail: "#12181c", railLight: "#2a3238", railDark: "#080b0d",
    },
    rails: "bezel",
    lamp: 0.07,
    vignette: 0.1,
    sight: SIGHT_DIM,
    cue: CUE_MINIMAL,
  },
];

export const DEFAULT_THEME = THEMES[0].id;

/** The ids, in the order they unlock. storage.js keeps its own copy of
 * this list — it owns its persisted shape and must not import game logic
 * — and test/storage.test.js asserts the two agree. */
export const THEME_IDS = THEMES.map((t) => t.id);

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** @param {{stagesCleared:number}} ctx */
export function isThemeUnlocked(id, ctx) {
  return (ctx?.stagesCleared || 0) >= themeById(id).unlockAt;
}
