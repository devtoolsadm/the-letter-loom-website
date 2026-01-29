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

// Palette of player colors (string identifiers or hex values)
const USE_VIVID_PLAYER_COLORS = true;

const PLAYER_COLORS_PASTEL = [
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
const SIMULATED_MATCH_SEEDS = [
  {
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
    players: ["Raquel", "Ramon", "Rafa"],
    preferences: {
      playersCount: 3,
      strategySeconds: 15,
      creationSeconds: 15,
      mode: MATCH_MODE_ROUNDS,
      roundsTarget: 16,
      pointsTarget: 500,
      scoringEnabled: true,
    },
    phase: "strategy-run",
    rounds: [[112, 18, 0]],
  },
];

function buildSimulatedMatchState(seed = {}) {
  const prefs = seed.preferences || {};
  const players = (seed.players || []).map((name, idx) => ({
    id: `p${idx + 1}`,
    name,
    abbrev: String(name || "").slice(0, 3).toUpperCase(),
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
    round: Number.isFinite(Number(seed.round)) ? Number(seed.round) : rounds.length ? rounds.length + 1 : 1,
    phase,
    remaining,
    mode: prefs.mode === MATCH_MODE_POINTS ? MATCH_MODE_POINTS : MATCH_MODE_ROUNDS,
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

export const SIMULATED_MATCH_STATE = buildSimulatedMatchState(SIMULATED_MATCH_SEEDS[1]);
