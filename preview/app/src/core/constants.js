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

export const DEFAULT_PLAYER_COUNT = 4;
export const ROUND_KEYPAD_AUTO_ZERO_ON_NAV = false;

// Apply fixed player name styling when using vivid colors.
if (USE_VIVID_PLAYER_COLORS && typeof document !== "undefined") {
  const root = document.documentElement;
  root.style.setProperty("--player-name-color", "#ffffff");
  root.style.setProperty(
    "--player-name-shadow",
    "0 1px 0 rgba(0,0,0,0.6), 0 -1px 0 rgba(0,0,0,0.6), 1px 0 0 rgba(0,0,0,0.6), -1px 0 0 rgba(0,0,0,0.6)"
  );
}
