/**
 * ui/match/actionsController.js — Single owner of the actions-phase driver.
 *
 * Replaces what used to be scattered in training.js:
 *  - actionsDriverBusy / actionsDriverTimeout module variables
 *  - stopActionsDriver / scheduleActionsDriver
 *  - resumeDriverIfActions
 *  - advanceAfterGhostAction (queue advance + last-actor cooldown)
 *  - safety-net auto-schedule inside renderTrainingMatch
 *
 * The host (training.js, future online.js) registers a "process next turn"
 * callback via setProcessTurnFn(). The controller schedules ticks of that
 * callback with a configurable gap. The host also registers how to advance
 * the queue (core's `advanceActionsQueue`), how to read state, how to
 * render, and an optional emergency-draw hook.
 *
 * Busy semantics:
 *  - One named mutex with a `reason` tag. While busy, scheduled ticks are
 *    skipped (the timeout still fires but the callback returns early), and
 *    `ensureDriverScheduledIfNeeded` won't schedule new work.
 *  - The host marks busy before opening a picker, then clears it when the
 *    picker resolves.
 *  - `advanceAfterAction` marks busy automatically during the last-actor
 *    cooldown so nothing else can race the queue advance.
 */

import { TIMING } from "./timing.js";

let _getState = () => null;
let _advanceQueue = (s) => s;
let _render = () => {};
let _onEmergencyDraw = null; // optional (resumeFn) => boolean
let _cooldownMs = TIMING.bubble.autoHide;
let _ghostGapMs = TIMING.actionsDriver.ghostGapMs;

let _busy = false;
let _busyReason = null;
let _timeoutId = null;
let _processTurnFn = () => {};

export function configureActionsController(opts = {}) {
  if (typeof opts.getState === "function") _getState = opts.getState;
  if (typeof opts.advanceQueue === "function") _advanceQueue = opts.advanceQueue;
  if (typeof opts.render === "function") _render = opts.render;
  if (typeof opts.onEmergencyDraw === "function") _onEmergencyDraw = opts.onEmergencyDraw;
  else if (opts.onEmergencyDraw === null) _onEmergencyDraw = null;
  if (typeof opts.cooldownMs === "number") _cooldownMs = opts.cooldownMs;
  if (typeof opts.ghostGapMs === "number") _ghostGapMs = opts.ghostGapMs;
}

export function setProcessTurnFn(fn) {
  if (typeof fn === "function") _processTurnFn = fn;
}

// ─── Busy mutex ───────────────────────────────────────────────────────────

export function isDriverBusy() { return _busy; }
export function getDriverBusyReason() { return _busyReason; }
export function markDriverBusy(reason = "anonymous") { _busy = true; _busyReason = reason; }
export function clearDriverBusy() { _busy = false; _busyReason = null; }

// ─── Scheduling ───────────────────────────────────────────────────────────

export function stopDriver() {
  if (_timeoutId) {
    clearTimeout(_timeoutId);
    _timeoutId = null;
  }
  _busy = false;
  _busyReason = null;
}

export function isDriverScheduled() {
  return !!_timeoutId;
}

export function scheduleDriverTick(delay = _ghostGapMs) {
  if (_timeoutId) clearTimeout(_timeoutId);
  _timeoutId = setTimeout(() => {
    _timeoutId = null;
    if (_busy) return; // tick suppressed while busy (re-enters via clear)
    _processTurnFn();
  }, delay);
}

// Safety-net helper: called from the host render to make sure the driver
// keeps ticking when in actions phase with a non-empty queue. No-op if a
// tick is already pending or a mutex is held.
export function ensureDriverScheduledIfNeeded() {
  if (_busy || _timeoutId) return;
  const s = _getState();
  if (!s || s.phase !== "actions") return;
  if ((s.actionsQueue?.length ?? 0) === 0) return;
  scheduleDriverTick();
}

// ─── Single advance point ─────────────────────────────────────────────────

function resumeIfActions() {
  const cur = _getState();
  if (cur?.phase === "actions") scheduleDriverTick();
}

// Call AFTER an actor's action has been applied. Handles the queue advance,
// the last-actor cooldown (queue stays full while the bubble/banner of the
// final actor settle), the emergency-draw hook, and scheduling the next
// tick. Single source of truth for both ghost and user-action paths.
export function advanceAfterAction(stateAfter) {
  const isLast = (stateAfter?.actionsQueue ?? []).length <= 1;
  if (!isLast) {
    const next = _advanceQueue(stateAfter);
    _render();
    if (_onEmergencyDraw && _onEmergencyDraw(resumeIfActions)) return;
    if (next.phase === "actions") scheduleDriverTick();
    return;
  }
  // Last actor — keep the queue intact, render so the bubble lands on
  // their pill, then defer the actual advance. We mark busy so the
  // safety-net can't race a fresh tick onto the same actor (which was the
  // root cause of the "ghost plays twice" bug).
  markDriverBusy("last-actor-cooldown");
  _render();
  setTimeout(() => {
    clearDriverBusy();
    const cur = _getState();
    if (!cur || cur.phase !== "actions") return;
    _advanceQueue(cur);
    _render();
    if (_onEmergencyDraw) _onEmergencyDraw(resumeIfActions);
  }, _cooldownMs);
}
