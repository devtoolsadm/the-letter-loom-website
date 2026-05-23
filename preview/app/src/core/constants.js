// Shared constants for match configuration and player settings

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const PLAYER_NAME_MAX = 12;
// Timers (seconds)
export const MIN_PHASE_SECONDS = 10;
export const MAX_PHASE_SECONDS = 180;

// Default timing
export const DEFAULT_STRATEGY_SECONDS = 30;
export const DEFAULT_CREATION_SECONDS = 60;

// Default targets
export const DEFAULT_ROUNDS_TARGET = 8;
export const DEFAULT_POINTS_TARGET = 100;

// Round scoring (points)
export const MIN_ROUND_SCORE = -8;
export const MAX_ROUND_SCORE = 200;
export const CREATION_TIMEUP_AUTO_ACTION_MS = 3000;

// Mode identifiers
export const MATCH_MODE_ROUNDS = "rounds";
export const MATCH_MODE_POINTS = "points";

// Match type identifiers
export const MATCH_TYPE_SCOREBOARD = "scoreboard"; // physical game, app tracks scores
export const MATCH_TYPE_TRAINING   = "training";   // solo training against simulated players

// ── Training mode ────────────────────────────────────────────
// Composition of decks. Values to be adjusted against the physical game.

export const TRAINING_MIN_OPPONENTS = 1;
export const TRAINING_MAX_OPPONENTS = 5;
export const TRAINING_DEFAULT_OPPONENTS = 2;
export const TRAINING_MIN_WORD_LETTERS = 2;
export const TRAINING_HAND_LETTERS = 3;
export const TRAINING_HAND_ACTIONS = 2;
export const TRAINING_CENTRAL_BOARD_SIZE = 5;

// Letter background colors (used for x2 same-color scoring). "none" is the
// wildcard color (no x2 contribution). Order must match the column order
// in VOWELS_RAW / CONSONANTS_RAW below.
export const LETTER_COLORS = ["blue", "orange", "green", "purple"];
const COLORS_ORDER = ["blue", "orange", "green", "purple"];

// Compact data per letter:
//   [letter, baseValue, [blue, orange, green, purple], tildeValue?, tildeForm?, tildeKind?]
// tildeValue: extra higher score when the card is played in its marked
// position (with tilde or diéresis).
// tildeForm: actual marked character to display (Á, É, …, Ú, Ü).
// tildeKind: "tilde" | "diaeresis" — only affects UI labels.
const VOWELS_RAW = [
  ["E",  2, [1, 2, 2, 2]],
  ["E",  2, [1, 0, 0, 0], 10, "É", "tilde"],
  ["A",  2, [2, 1, 2, 2]],
  ["A",  2, [0, 1, 0, 0], 10, "Á", "tilde"],
  ["O",  2, [2, 2, 1, 1]],
  ["O",  2, [0, 0, 1, 0], 10, "Ó", "tilde"],
  ["I",  2, [1, 1, 1, 1]],
  ["I",  2, [0, 0, 0, 1], 10, "Í", "tilde"],
  ["U",  4, [1, 1, 1, 0]],
  ["U",  4, [0, 0, 0, 1], 14, "Ú", "tilde"],
  ["U",  4, [0, 0, 0, 1], 14, "Ü", "diaeresis"],
];

const CONSONANTS_RAW = [
  ["S",   4, [2, 2, 1, 1]],
  ["R",   4, [1, 1, 2, 2]],
  ["N",   4, [2, 1, 2, 1]],
  ["D",   4, [1, 1, 1, 2]],
  ["L",   4, [1, 1, 1, 1]],
  ["C",   4, [1, 1, 1, 1]],
  ["T",   4, [1, 1, 1, 1]],
  ["M",   4, [0, 1, 1, 1]],
  ["P",   4, [1, 0, 1, 1]],
  ["B",   6, [1, 1, 0, 1]],
  ["G",   6, [1, 1, 1, 0]],
  ["V",   8, [0, 1, 1, 1]],
  ["Y",  10, [1, 0, 1, 1]],
  ["QU", 12, [1, 1, 0, 1]],
  ["H",   8, [1, 1, 1, 0]],
  ["F",   8, [0, 1, 1, 1]],
  ["Z",  10, [1, 1, 0, 0]],
  ["J",   8, [0, 0, 1, 1]],
  ["Ñ",  14, [1, 0, 1, 0]],
  ["X",  12, [0, 1, 0, 1]],
  ["K",  14, [1, 1, 0, 0]],
  ["W",  14, [0, 0, 1, 1]],
];

function expandLetterDefs(defs) {
  const out = [];
  for (const row of defs) {
    const [letter, value, counts, tildeValue, tildeForm, tildeKind] = row;
    counts.forEach((count, idx) => {
      if (count > 0) {
        const entry = { letter, value, color: COLORS_ORDER[idx], count };
        if (typeof tildeValue === "number") {
          entry.tildeValue = tildeValue;
          entry.tildeForm = tildeForm ?? letter;
          entry.tildeKind = tildeKind ?? "tilde";
        }
        out.push(entry);
      }
    });
  }
  return out;
}

export const VOWEL_DECK_DEF = expandLetterDefs(VOWELS_RAW);
export const CONSONANT_DECK_DEF = expandLetterDefs(CONSONANTS_RAW);

// Wildcards: 2 vowel-wildcards, 2 consonant-wildcards (value 0, no color).
export const TRAINING_VOWEL_WILDCARDS = 2;
export const TRAINING_CONSONANT_WILDCARDS = 2;

// Action card definitions. id = stable identifier used across state, analytics, etc.
// kind: 'self_bonus' | 'board' | 'attack' | 'rule_force' | 'shield'
// target: 'self' | 'one' | 'all'
// count: number of copies of this card in the deck
// inMVP: false → deferred (PALABRA EXTRA, INVENTA TU REGLA, UNA PARA TODOS)
export const ACTION_CARDS = [
  { id: "in_english",    kind: "rule_force", target: "self", count: 3, inMVP: false },
  { id: "boost_total",   kind: "self_bonus", target: "self", count: 2, inMVP: true },
  { id: "extra_card",    kind: "self_bonus", target: "self", count: 5, inMVP: true },
  { id: "wildcard",      kind: "self_bonus", target: "self", count: 5, inMVP: true },
  { id: "shield_total",  kind: "shield",     target: "self", count: 5, inMVP: true },
  { id: "change_cards",  kind: "self_bonus", target: "self", count: 5, inMVP: true },
  { id: "use_vowel",     kind: "rule_force", target: "all",  count: 2, inMVP: true },
  { id: "use_consonant", kind: "rule_force", target: "all",  count: 2, inMVP: true },
  { id: "use_letter",    kind: "rule_force", target: "all",  count: 1, inMVP: true },
  { id: "two_to_center", kind: "board",      target: "all",  count: 4, inMVP: true },
  { id: "out_one",       kind: "attack",     target: "all",  count: 3, inMVP: true },
  { id: "great_heist",   kind: "attack",     target: "all",  count: 4, inMVP: true },
  { id: "steal_letter",  kind: "attack",     target: "one",  count: 5, inMVP: true },
  { id: "renew_board",   kind: "board",      target: "self", count: 3, inMVP: true },
  { id: "swap_all",      kind: "attack",     target: "one",  count: 3, inMVP: true },
  { id: "swap_one",      kind: "attack",     target: "one",  count: 4, inMVP: true },
  { id: "solo_mia",      kind: "board",      target: "self", count: 4, inMVP: true },
  { id: "one_for_all",   kind: "board",      target: "one",  count: 3, inMVP: true },
  { id: "philologist",   kind: "rule_force", target: "one",  count: 3, inMVP: true },
  { id: "brain_squeeze", kind: "rule_force", target: "one",  count: 3, inMVP: true },
  { id: "explosion",     kind: "attack",     target: "one",  count: 2, inMVP: true },
  { id: "discard_one",   kind: "attack",     target: "one",  count: 4, inMVP: true },
];

// Self-bonus point modifiers (applied before x2)
export const ACTION_POINTS = {
  in_english:  10,
  boost_total: 6,
  wildcard:    6,
  explosion:  -4,
};

// Ghost score distribution by difficulty level.
export const GHOST_SCORE_LEVELS = {
  easy:   { mean:  6, stdDev: 4, invalidRate: 0.20 },
  normal: { mean: 12, stdDev: 6, invalidRate: 0.10 },
  hard:   { mean: 20, stdDev: 8, invalidRate: 0.05 },
};
export const GHOST_DEFAULT_LEVEL = "normal";

// Full presets for the 3 difficulty levels (the only thing the user picks).
// Adjust as we tune the game.
export const TRAINING_DIFFICULTY_PRESETS = {
  easy:   { opponents: 2, strategySeconds: 30, creationSeconds: 60, roundsTarget: 6, ghostLevel: "easy"   },
  normal: { opponents: 3, strategySeconds: 20, creationSeconds: 40, roundsTarget: 6, ghostLevel: "normal" },
  hard:   { opponents: 4, strategySeconds: 10, creationSeconds: 30, roundsTarget: 6, ghostLevel: "hard"   },
};
export const TRAINING_DIFFICULTIES = ["easy", "normal", "hard"];

// Palette of player colors (string identifiers or hex values)
const USE_VIVID_PLAYER_COLORS = true;

export const PLAYER_COLORS_PASTEL = [
  "#FFB3B3", // Light red
  "#AFC3FF", // Light blue
  "#D8B6FF", // Light purple
  "#F7B5D1", // Light pink
  "#FFCBA4", // Light orange
  "#FFE9A6", // Light yellow
  "#C8F5A4", // Light lime
  "#A6E6B0", // Light green
  "#99E2D9", // Light teal
  "#A6E3FF", // Light cyan
];

const PLAYER_COLORS_VIVID = [
  "#FF6B6B", // Vivid red
  "#54A0FF", // Vivid blue
  "#A55EEA", // Vivid purple
  "#F368E0", // Vivid pink
  "#FF9F1A", // Vivid orange
  "#FFD93D", // Vivid yellow
  "#B9F46E", // Vivid lime
  "#4CD964", // Vivid green
  "#1DD1A1", // Vivid teal
  "#48DBFB", // Vivid cyan
];

export const PLAYER_COLORS = USE_VIVID_PLAYER_COLORS
  ? PLAYER_COLORS_VIVID
  : PLAYER_COLORS_PASTEL;

export const DEFAULT_PLAYER_COUNT = 2;
export const ROUND_KEYPAD_AUTO_ZERO_ON_NAV = false;
export const RECORD_MIN_POINTS = 20;
export const RECORD_AVG_PENALTY_THRESHOLD = 5;
export const RECORD_AVG_PENALTY_DECAY = 6;
export const RECORD_AVG_PENALTY_MAX = 0.1;
export const WAKE_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
export const WAKE_LOCK_SUCCESS_DEBOUNCE_MS = 30 * 1000;

// Apply fixed player name styling when using vivid colors.
if (USE_VIVID_PLAYER_COLORS && typeof document !== "undefined") {
  const root = document.documentElement;
  root.style.setProperty("--player-name-color", "#ffffff");
  root.style.setProperty(
    "--player-name-shadow",
    "0 1px 0 rgba(0,0,0,0.6), 0 -1px 0 rgba(0,0,0,0.6), 1px 0 0 rgba(0,0,0,0.6), -1px 0 0 rgba(0,0,0,0.6)",
  );
}

// Debug-only: preload a simulated match on app start.
export const SIMULATE_MATCH_ON_START = true;
export const SIMULATE_RECORDS_ON_START = false;
export const SIMULATE_NAMES_ON_START = false;
export const SIMULATED_KNOWN_NAMES = [
  "Andrea",
  "Martina",
  "Raquel",
  "Ramon",
  "Refa",
  "Elvira",
  "Juan",
  "Sebastián",
  "Maria",
  "Marcos",
  "Margina",
  "Isabel",
  "Lucas",
  "Nerea",
  "Tomas",
  "Aitana",
  "Hugo",
  "Sofia",
  "Mateo",
  "Noa",
  "Javier",
  "Valeria",
  "Dario",
  "Lucia",
  "Alba",
  "Daniel",
  "Carla",
  "Pablo",
  "Sara",
  "Adrian",
  "Irene",
  "Bruno",
  "Claudia",
  "Gonzalo",
  "Eva",
  "Rocio",
  "Julieta",
  "Victor",
  "Olga",
  "Mario",
];
export const SIMULATED_MATCH_SEEDS = [
  {
    matchId: "sim-match-8p",
    lastSavedAt: "2026-01-29T08:00:00Z",
    players: [
      "Raquel",
      "Ramon",
      "Refa",
      "Elvira",
      "Juan Sebastián",
      "A.Sebastiánduroitia",
      "Andrea",
      "Margina",
    ],
    preferences: {
      playersCount: 8,
      strategySeconds: 15,
      creationSeconds: 15,
      mode: MATCH_MODE_ROUNDS,
      roundsTarget: 16,
      pointsTarget: 500,
      scoringEnabled: true,
      validateRecordWords: true,
    },
    phase: "creation-ready",
    rounds: [
      [112, 18, 0, 24, 10, 14, 20, 8],
      [130, 0, 16, 12, 6, 22, 28, 18],
      [14, 26, 10, 0, 12, 18, 24, 16],
      [8, 20, 14, 26, 0, 30, 22, 12],
      [18, 24, 12, 10, 16, 8, 26, 0],
      [22, 0, 18, 14, 20, 0, 28, 16],
      [6, 26, 0, 18, 24, 124, 30, 12],
      [12, 22, 16, 0, 18, 4, -8, 0],
      [12, 18, 0, 24, 10, 14, 20, 8],
      [30, 0, 16, 12, 6, 22, 28, 18],
      [14, 26, 10, 0, 12, 18, 24, 16],
      [8, 20, 14, 26, 0, 30, 22, 12],
      [18, 24, 12, 10, 16, 8, 26, 0],
      [22, 0, 18, 14, 20, 0, 28, 16],
      [6, 26, 0, 18, 24, -24, 30, 12],
    ],
  },
  {
    matchId: "sim-match-3p",
    players: ["Raquel", "Rafa"],
    preferences: {
      playersCount: 2,
      strategySeconds: 15,
      creationSeconds: 15,
      mode: MATCH_MODE_ROUNDS,
      roundsTarget: 3,
      pointsTarget: 500,
      scoringEnabled: true,
      validateRecordWords: true,
    },
    phase: "creation-run",
    rounds: [
      [112, 18, 0],
      [130, 0, 16],
    ],
  },
];

export function buildSimulatedMatchState(seed = {}) {
  const prefs = seed.preferences || {};
  const players = (seed.players || []).map((name, idx) => ({
    id: `p${idx + 1}`,
    name,
    abbrev: String(name || "")
      .slice(0, 3)
      .toUpperCase(),
    color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
    score: 0,
    rounds: [],
  }));

  const rounds = Array.isArray(seed.rounds) ? seed.rounds : [];
  rounds.forEach((scores, roundIndex) => {
    players.forEach((player, idx) => {
      const value = Array.isArray(scores) ? scores[idx] : 0;
      const points = Number.isFinite(Number(value)) ? Number(value) : 0;
      player.rounds.push({ round: roundIndex + 1, points, tieBreak: false });
      player.score += points;
    });
  });

  const strategySeconds = prefs.strategySeconds ?? DEFAULT_STRATEGY_SECONDS;
  const creationSeconds = prefs.creationSeconds ?? DEFAULT_CREATION_SECONDS;
  const phase = seed.phase || "strategy-ready";
  const remaining = Number.isFinite(Number(seed.remaining))
    ? Number(seed.remaining)
    : phase.startsWith("creation")
      ? creationSeconds
      : phase.startsWith("strategy")
        ? strategySeconds
        : 0;
  const resolveSeedTime = (value) => {
    if (Number.isFinite(Number(value))) return Number(value);
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  };
  const updatedAt =
    resolveSeedTime(seed.updatedAt) ??
    resolveSeedTime(seed.lastSavedAt) ??
    Date.now();
  return {
    matchId: seed.matchId || `sim-${Date.now().toString(36)}`,
    isActive: seed.isActive ?? true,
    round: Number.isFinite(Number(seed.round))
      ? Number(seed.round)
      : rounds.length
        ? rounds.length + 1
        : 1,
    phase,
    remaining,
    mode:
      prefs.mode === MATCH_MODE_POINTS ? MATCH_MODE_POINTS : MATCH_MODE_ROUNDS,
    roundsTarget: prefs.roundsTarget ?? DEFAULT_ROUNDS_TARGET,
    pointsTarget: prefs.pointsTarget ?? DEFAULT_POINTS_TARGET,
    scoringEnabled: prefs.scoringEnabled ?? true,
    strategySeconds,
    creationSeconds,
    players,
    tieBreak: null,
    tieBreakPending: null,
    winnerIds: [],
    matchOver: false,
    preferencesRef: { ...prefs },
    updatedAt,
  };
}

export const SIMULATED_MATCH_STATE = buildSimulatedMatchState(
  SIMULATED_MATCH_SEEDS[0],
);

export const SIMULATED_RECORDS = {
  bestWord: [
    {
      matchId: "sim-match-8p",
      playerId: "p6",
      playerName: "A.Sebastiánduroitia",
      round: 7,
      word: "ESTRATEGIA",
      points: 124,
      when: "2026-01-29T08:05:00Z",
      features: {
        sameColor: true,
        usedWildcard: false,
        doubleScore: true,
        plusPoints: true,
        minusPoints: false,
      },
    },
    {
      matchId: "sim-match-8p",
      playerId: "p1",
      playerName: "Raquel",
      round: 2,
      word: "LUMINOSA",
      points: 130,
      when: "2026-01-29T08:10:00Z",
      features: {
        sameColor: false,
        usedWildcard: true,
        doubleScore: true,
        plusPoints: false,
        minusPoints: false,
      },
    },
    {
      matchId: "sim-match-8p",
      playerId: "p3",
      playerName: "Rafa",
      round: 5,
      word: "INSPIRACION",
      points: 130,
      when: "2026-01-29T08:45:00Z",
      features: {
        sameColor: true,
        usedWildcard: true,
        doubleScore: false,
        plusPoints: true,
        minusPoints: false,
      },
    },
    {
      matchId: "sim-match-8p",
      playerId: "p2",
      playerName: "Ramon",
      round: 9,
      word: "CONSTRUCCION",
      points: 118,
      when: "2026-01-29T08:55:00Z",
      features: {
        sameColor: false,
        usedWildcard: false,
        doubleScore: false,
        plusPoints: true,
        minusPoints: false,
      },
    },
    {
      matchId: "sim-match-8p",
      playerId: "p4",
      playerName: "Elvira",
      round: 11,
      word: "EXTRAVAGANTE",
      points: 112,
      when: "2026-01-29T09:05:00Z",
      features: {
        sameColor: true,
        usedWildcard: false,
        doubleScore: true,
        plusPoints: false,
        minusPoints: true,
      },
    },
    {
      matchId: "sim-match-8p",
      playerId: "p5",
      playerName: "Juan Sebastián",
      round: 12,
      word: "SOMBRA",
      points: 112,
      when: "2026-01-29T09:20:00Z",
      features: {
        sameColor: false,
        usedWildcard: false,
        doubleScore: false,
        plusPoints: false,
        minusPoints: true,
      },
    },
    {
      matchId: "sim-match-8p",
      playerId: "p7",
      playerName: "Andrea",
      round: 6,
      word: "ORIGENES",
      points: 108,
      when: "2026-01-29T09:35:00Z",
      features: {
        sameColor: true,
        usedWildcard: true,
        doubleScore: false,
        plusPoints: false,
        minusPoints: false,
      },
    },
    {
      matchId: "sim-match-8p",
      playerId: "p8",
      playerName: "Marcos",
      round: 8,
      word: "CARACTERISTICO",
      points: 106,
      when: "2026-01-29T09:50:00Z",
      features: {
        sameColor: false,
        usedWildcard: false,
        doubleScore: true,
        plusPoints: true,
        minusPoints: false,
      },
    },
    {
      matchId: "sim-match-8p",
      playerId: "p6",
      playerName: "A.Sebastiánduroitia",
      round: 10,
      word: "DESCONOCIMIENTO",
      points: 104,
      when: "2026-01-29T10:05:00Z",
      features: {
        sameColor: true,
        usedWildcard: false,
        doubleScore: false,
        plusPoints: true,
        minusPoints: false,
      },
    },
    {
      matchId: "sim-match-8p",
      playerId: "p2",
      playerName: "Ramon",
      round: 13,
      word: "INCONMENSURABLE",
      points: 102,
      when: "2026-01-29T10:20:00Z",
      features: {
        sameColor: false,
        usedWildcard: true,
        doubleScore: true,
        plusPoints: false,
        minusPoints: true,
      },
    },
  ],
  bestMatch: [
    {
      matchId: "sim-match-8p",
      playerId: "p1",
      playerName: "Raquel",
      points: 28.8,
      rounds: 15,
      when: "2026-01-29T08:20:00Z",
      otherPlayers: [
        "Ramon",
        "Rafa",
        "Elvira",
        "Juan",
        "Marcos",
        "Andrea",
        "A.Sebastián",
      ],
    },
    {
      matchId: "sim-match-8p",
      playerId: "p7",
      playerName: "Andrea",
      points: 24.46,
      rounds: 15,
      when: "2026-01-29T08:20:00Z",
      otherPlayers: [
        "Raquel",
        "Ramon",
        "Rafa",
        "Elvira",
        "Juan",
        "Marcos",
        "A.Sebastián",
      ],
    },
    {
      matchId: "sim-match-8p",
      playerId: "p2",
      playerName: "Ramon",
      points: 24.86,
      rounds: 14,
      when: "2026-01-29T09:15:00Z",
      otherPlayers: [
        "Raquel",
        "Rafa",
        "Elvira",
        "Juan",
        "Marcos",
        "Andrea",
        "A.Sebastián",
      ],
    },
    {
      matchId: "sim-match-8p",
      playerId: "p6",
      playerName: "A.Sebastiánduroitia",
      points: 22.4,
      rounds: 15,
      when: "2026-01-29T09:05:00Z",
      otherPlayers: [
        "Raquel",
        "Ramon",
        "Rafa",
        "Elvira",
        "Juan",
        "Marcos",
        "Andrea",
      ],
    },
    {
      matchId: "sim-match-8p",
      playerId: "p4",
      playerName: "Elvira",
      points: 22.29,
      rounds: 14,
      when: "2026-01-29T09:30:00Z",
      otherPlayers: [
        "Raquel",
        "Ramon",
        "Rafa",
        "Juan",
        "Marcos",
        "Andrea",
        "A.Sebastián",
      ],
    },
    {
      matchId: "sim-match-8p",
      playerId: "p5",
      playerName: "Juan Sebastián",
      points: 24.0,
      rounds: 13,
      when: "2026-01-29T10:10:00Z",
      otherPlayers: [
        "Raquel",
        "Ramon",
        "Rafa",
        "Elvira",
        "Marcos",
        "Andrea",
        "A.Sebastián",
      ],
    },
  ],
};
