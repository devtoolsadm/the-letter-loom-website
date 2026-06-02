/**
 * ui/match/timing.js — Single source of truth for in-match UI timings.
 *
 * Tweaks to game pacing happen here, not buried inside each module. All
 * shared screens (training, future online) read from this table.
 */

export const TIMING = {
  // Centered phase-transition banner ("ESTRATEGIA" / "CREACIÓN").
  phaseFlash: {
    duration: 2400,         // total visible time
    strategyBannerDelay: 760, // wait for last V/C card flip before showing
  },

  // Bubble on the actor's pill ("STEAL_LETTER", etc.) and the red header
  // banner that fires when the user is targeted.
  bubble: {
    autoHide: 4500,         // total bubble life
  },
  banner: {
    visible: 3000,          // red banner stays this long
    hideTransition: 300,    // fade-out duration
  },

  // Per-card flips and reveals during dealing.
  reveal: {
    flipDuration: 720,      // V/C → face-down flip (matches CSS keyframe)
  },

  // Deal cascade: face-down hand cards flip to face-up after strategy
  // banner finishes. Small buffer so the banner-hide render doesn't race
  // the cascade render.
  dealCascade: {
    afterFlashBuffer: 90,
  },

  // Hand picker hold: when the board has just become full, wait this many
  // ms before showing the hand V/C pickers so the user can read the
  // freshly revealed letters.
  boardReveal: {
    pause: 1400,
  },

  // When a ghost is the dealer, show face-down board cards briefly, then
  // flip them with the cascade.
  ghostBoardDeal: {
    hold: 800,
  },

  // Pause between bubble/banner appearing and the actual card animations
  // starting, so the user reads first. Skipped (0) for the user's own
  // actions.
  actionRead: {
    delay: 700,
  },

  // Pause between consecutive ghost actions in the actions phase.
  actionsDriver: {
    ghostGapMs: 3000,
  },

  // User-pill shake when targeted by an attack.
  pillShake: 700,

  // User's individual turn timer in the actions phase (ms).
  userTurn: 10000,

  // Picker timeout (target/letter/etc. pickers default to first option).
  picker: 7000,

  // Threshold (seconds) below which the strategy/creation timer pulses.
  lowTime: 10,

  // Practice mode: show the hint button after this many ms of creation.
  practiceHint: 30000,
};
