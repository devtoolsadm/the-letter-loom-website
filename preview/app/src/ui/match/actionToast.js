/**
 * ui/match/actionToast.js — Visual narration for an action being played:
 *  - Bubble attached to the actor's player pill ("STEAL_LETTER", "🛡 ..." etc.)
 *  - Red banner at the top of the screen when the user is targeted
 *  - User-pill shake on attacks
 *
 * Shared between training and the future online match. Host injects the
 * pieces it owns (i18n, action-name humaniser, pill selector, attack
 * detection metadata).
 */

import { TIMING } from "./timing.js";

let currentActionBubble = null;
let bubbleAutoHideTimeout = null;
let attackBannerTimeout = null;

export const BUBBLE_AUTOHIDE_MS = TIMING.bubble.autoHide;
const BANNER_VISIBLE_MS = TIMING.banner.visible;
const BANNER_HIDE_TRANSITION_MS = TIMING.banner.hideTransition;
const PILL_SHAKE_MS = TIMING.pillShake;

let _humanActionName = (id) => id;
let _isReachingUser = () => false;
let _bannerElementId = "trainingAttackBanner";
let _bubbleClass = "training-action-bubble";
let _pillSelector = (pid) => `.training-score-pill[data-player-id="${pid}"]`;
let _userPillSelector = ".training-score-pill.is-user";

export function configureActionToast(opts = {}) {
  if (typeof opts.humanActionName === "function") _humanActionName = opts.humanActionName;
  // isReachingUser(state, log) → boolean. Determines whether the user is
  // affected (target=userId OR action's target metadata is "all"). Bubble
  // is rendered red and the banner is fired when this returns true.
  if (typeof opts.isReachingUser === "function") _isReachingUser = opts.isReachingUser;
  if (opts.bannerElementId) _bannerElementId = opts.bannerElementId;
  if (opts.bubbleClass) _bubbleClass = opts.bubbleClass;
  if (typeof opts.pillSelector === "function") _pillSelector = opts.pillSelector;
  if (opts.userPillSelector) _userPillSelector = opts.userPillSelector;
}

export function getCurrentActionBubble() {
  return currentActionBubble;
}

export function triggerAttackBanner(attackerName, actionName) {
  const banner = document.getElementById(_bannerElementId);
  if (!banner) return;
  if (attackBannerTimeout) { clearTimeout(attackBannerTimeout); attackBannerTimeout = null; }
  banner.textContent = `⚠ ${attackerName}: ${actionName}`;
  banner.classList.remove("hidden", "is-hiding");
  banner.classList.add("is-visible");
  // Shake the user pill.
  const userPill = document.querySelector(_userPillSelector);
  if (userPill) {
    userPill.classList.remove("is-under-attack");
    void userPill.offsetWidth; // force reflow to restart animation
    userPill.classList.add("is-under-attack");
    setTimeout(() => userPill.classList.remove("is-under-attack"), PILL_SHAKE_MS);
  }
  attackBannerTimeout = setTimeout(() => {
    banner.classList.add("is-hiding");
    setTimeout(() => {
      banner.classList.add("hidden");
      banner.classList.remove("is-visible", "is-hiding");
    }, BANNER_HIDE_TRANSITION_MS);
    attackBannerTimeout = null;
  }, BANNER_VISIBLE_MS);
}

export function showActionToast(state, log, opts = {}) {
  if (!log) return;
  if (bubbleAutoHideTimeout) clearTimeout(bubbleAutoHideTimeout);
  const userId = state?.players?.[0]?.id;
  const reachesUser = _isReachingUser(state, log);
  // Already shielded for this trick (from a prior reactive shield) → the
  // action no longer affects the user. Treated the same as `opts.blocked`
  // (which only flags a freshly-used shield on THIS attack).
  const alreadyShielded = !!(userId && (state?.shieldedPlayers ?? []).includes(userId));
  const blocked = !!opts.blocked || (reachesUser && alreadyShielded);
  const isAttackTarget = reachesUser && !blocked;
  currentActionBubble = {
    playerId: log.playerId,
    text: _humanActionName(log.actionId),
    blocked,
    isAttackOnUser: isAttackTarget,
    isNew: true,
  };
  if (isAttackTarget) {
    const attacker = (state?.players ?? []).find((p) => p.id === log.playerId);
    triggerAttackBanner(attacker?.name || log.playerId, _humanActionName(log.actionId));
  }
  attachActionBubble();
  bubbleAutoHideTimeout = setTimeout(clearActionBanner, BUBBLE_AUTOHIDE_MS);
}

export function clearActionBanner() {
  if (bubbleAutoHideTimeout) {
    clearTimeout(bubbleAutoHideTimeout);
    bubbleAutoHideTimeout = null;
  }
  currentActionBubble = null;
  document.querySelectorAll(`.${_bubbleClass}`).forEach((el) => el.remove());
}

export function attachActionBubble() {
  const existing = document.querySelector(`.${_bubbleClass}`);
  if (!currentActionBubble) {
    if (existing) existing.remove();
    return;
  }
  const targetPill = document.querySelector(_pillSelector(currentActionBubble.playerId));
  if (!targetPill) {
    if (existing) existing.remove();
    return;
  }
  const expectedKey =
    `${currentActionBubble.playerId}|${currentActionBubble.text}|${currentActionBubble.blocked ? 1 : 0}|${currentActionBubble.isAttackOnUser ? 1 : 0}`;
  // Already on the right pill with the right content → leave it (no flicker).
  if (existing && existing.parentElement === targetPill && existing.dataset.key === expectedKey) {
    return;
  }
  if (existing) existing.remove();
  const bubble = document.createElement("div");
  bubble.className = _bubbleClass
    + (currentActionBubble.blocked ? " is-blocked" : "")
    + (currentActionBubble.isAttackOnUser && !currentActionBubble.blocked ? " is-attack" : "");
  bubble.dataset.key = expectedKey;
  bubble.textContent = (currentActionBubble.blocked ? "🛡 " : "") + currentActionBubble.text;
  if (!currentActionBubble.isNew) {
    bubble.style.animation = "none";
  }
  currentActionBubble.isNew = false;
  targetPill.appendChild(bubble);
}
