/**
 * ui/match/phaseFlash.js — Big centered "ESTRATEGIA" / "CREACIÓN" banner
 * shown briefly when a phase transition starts. Also exposes the time at
 * which the banner finishes, so other UI bits (timer, deal cascade, etc.)
 * can gate themselves until the announcement has finished.
 *
 * Shared between training and the future online match — both have the
 * same strategy → actions → creation phase model.
 *
 * Host-specific bits are injected via configurePhaseFlash():
 *   - render(): re-runs the host's main render after the banner hides, so
 *     anything gated by `getPhaseFlashEndsAt()` wakes up.
 *   - t(key): i18n lookup for the phase label.
 *   - flashElementId: id of the DOM element used as the banner overlay.
 */

import { TIMING } from "./timing.js";
export const PHASE_FLASH_DURATION_MS = TIMING.phaseFlash.duration;
// Strategy entry: wait for the last V/C card flip (picker → face-down) to
// finish before showing the banner. The flip lasts ~720 ms; the small
// extra buffer keeps the sequence readable: pick → flip lands → banner
// pops.
export const STRATEGY_BANNER_DELAY_MS = TIMING.phaseFlash.strategyBannerDelay;

let _phaseFlashEndsAt = 0;
let _lastFlashedPhase = null;
let _render = () => {};
let _t = (k) => k;
let _flashElementId = "trainingPhaseFlash";

export function configurePhaseFlash({ render, t, flashElementId } = {}) {
  if (typeof render === "function") _render = render;
  if (typeof t === "function") _t = t;
  if (flashElementId) _flashElementId = flashElementId;
}

export function getPhaseFlashEndsAt() {
  return _phaseFlashEndsAt;
}

// Call when a new baza/round starts so the next "strategy"/"creation"
// transition triggers the banner again.
export function resetPhaseFlash() {
  _lastFlashedPhase = null;
}

function capitalizeStr(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

export function maybeShowPhaseFlash(state) {
  const phase = state?.phase;
  if (phase === _lastFlashedPhase) return;
  if (phase === "strategy" || phase === "creation") {
    const flash = document.getElementById(_flashElementId);
    if (!flash) {
      _lastFlashedPhase = phase;
      return;
    }
    const preDelay = phase === "strategy" ? STRATEGY_BANNER_DELAY_MS : 0;
    // Lock the timer/cascade gates from now until the banner actually
    // finishes (post-delay). Setting it BEFORE the setTimeout means
    // re-renders during the pre-delay window still treat the phase flash
    // as active.
    _phaseFlashEndsAt = Date.now() + preDelay + PHASE_FLASH_DURATION_MS;
    const showBanner = () => {
      const key = `trainingPhase${capitalizeStr(phase)}`;
      flash.textContent = _t(key) || phase.toUpperCase();
      flash.classList.remove("hidden");
      flash.style.animation = "none";
      void flash.offsetWidth;
      flash.style.animation = "";
      clearTimeout(flash._hideTimer);
      flash._hideTimer = setTimeout(() => {
        flash.classList.add("hidden");
        // Re-render so the gated timer (and any other phase-flash-blocked
        // bits of UI) start now that the banner is gone.
        _render();
      }, PHASE_FLASH_DURATION_MS);
    };
    if (preDelay > 0) setTimeout(showBanner, preDelay);
    else showBanner();
  }
  _lastFlashedPhase = phase;
}
