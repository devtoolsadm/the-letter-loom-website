/**
 * ui/match/online.js — Online multiplayer match screen (future)
 *
 * Follows the same pattern as training.js:
 *   - initOnline(callbacks) wires shell callbacks into _shell
 *   - setupOnlineEventListeners() registers DOM event handlers
 *   - renderOnlineMatch(state) renders the current match state
 *
 * Differences from training.js:
 *   - State comes from a remote sync (Supabase realtime) instead of a local
 *     trainingMatch.js controller. The module subscribes to a channel and
 *     calls renderOnlineMatch whenever the remote state changes.
 *   - Player turn / dealer / scoring are authoritative on the server; this
 *     module is read-mostly and sends intent messages rather than mutating
 *     state directly.
 *   - Reconnect and conflict-resolution logic lives here, not in core/.
 *
 * Shared UI components (same as training and scoreboard):
 *   - ui/components/actionCard.js  (renderActionCard, makeActionIconEl)
 *   - ui/components/letterCard.js  (renderLetterCard)
 *   - ui/components/matchPills.js  (renderMatchPills — player turn/dealer/shield pills)
 *
 * Shell callbacks received via initOnline (same _shell pattern):
 *   - showScreen, playClickFeedback, openConfirm, openQuickGuide
 *   - playClockLoop, stopClockLoop, triggerTimeUpEffects, playLowTimeTick
 *   - setI18nById, scaleGame, triggerHapticFeedback
 */

// Shell callbacks — populated by initOnline()
let _shell = {
  showScreen: () => {},
  playClickFeedback: () => {},
  openConfirm: () => {},
  openQuickGuide: () => {},
  playClockLoop: () => {},
  stopClockLoop: () => {},
  triggerTimeUpEffects: () => {},
  playLowTimeTick: () => {},
  setI18nById: () => {},
  scaleGame: () => {},
  triggerHapticFeedback: () => {},
};

export function initOnline(callbacks) {
  Object.assign(_shell, callbacks);
}

export function setupOnlineEventListeners() {
  // TODO: wire up online match button handlers (join room, leave, submit word…)
}

export function renderOnlineMatch(state) {
  // TODO: render the online match screen from remote state
  void state;
}

export function cleanupOnline() {
  // TODO: unsubscribe from realtime channel, clear timers
}
