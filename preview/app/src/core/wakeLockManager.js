import { logger } from "./logger.js";

let wakeLock = null;
let videoElement = null;
let statusElement = null;
let userRequestedLock = false;
let fallbackActive = false;
let wakeLockSupported = "wakeLock" in navigator;
let debugLogs = true;

const defaultStatusMessages = {
  activeStandard: "Status: Wake lock active (standard API).",
  released: "Status: Wake lock released by system.",
  activeFallback: "Status: Wake lock active (fallback video).",
  fallbackFailed: "Status: Wake lock fallback failed (video error).",
  inactive: "Status: Wake lock inactive."
};

let statusMessages = { ...defaultStatusMessages };

export function initWakeLockManager({ videoEl, statusEl, messages, showDebug = true }) {
  videoElement = videoEl;
  statusElement = statusEl;
  statusMessages = { ...defaultStatusMessages, ...(messages || {}) };
  debugLogs = !!showDebug;
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function handleVisibilityChange() {
  if (
    document.visibilityState === "visible" &&
    wakeLock === null &&
    userRequestedLock
  ) {
    logDebug("visibilitychange -> re-request wake lock");
    requestLock();
  }
}

function setStatus(msg) {
  if (statusElement) statusElement.textContent = msg;
}

export async function requestLock() {
  userRequestedLock = true;
  logDebug("requestLock invoked", { wakeLockSupported, hasWakeLock: !!wakeLock });

  if (wakeLockSupported && wakeLock) {
    logDebug("wake lock already held (standard)");
    return true;
  }

  if (wakeLockSupported) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        setStatus(statusMessages.released);
        wakeLock = null;
        logDebug("wake lock released by system");
      });
      setStatus(statusMessages.activeStandard);
      logDebug("wake lock acquired (standard)");
      return true;
    } catch (err) {
      logDebug(`wake lock failed (standard): ${err.name}, falling back`);
    }
  }

  const fallbackOk = await activateFallbackLock();
  userRequestedLock = fallbackOk;
  logDebug(`wake lock fallback result`, { success: fallbackOk });
  return fallbackOk;
}

async function activateFallbackLock() {
  if (videoElement) {
    try {
      await videoElement.play();
      fallbackActive = true;
      setStatus(statusMessages.activeFallback);
      logDebug("wake lock fallback video playing");
    } catch (e) {
      setStatus(statusMessages.fallbackFailed);
      logDebug("wake lock fallback video failed", { error: e?.message || e });
      fallbackActive = false;
    }
  } else {
    logDebug("wake lock fallback skipped (no video element)");
    fallbackActive = false;
  }
  return fallbackActive;
}

export async function releaseLock() {
  if (wakeLockSupported && wakeLock) {
    try {
      await wakeLock.release();
      wakeLock = null;
      setStatus(statusMessages.inactive);
      logDebug("wake lock released (standard)");
    } catch (err) {
      logDebug("wake lock release failed (standard)", { error: err?.message || err });
    }
  } else if (!wakeLockSupported && fallbackActive) {
    if (releaseFallbackLock()) {
      logDebug("wake lock released (fallback)");
    }
  }
  userRequestedLock = false;
}

function releaseFallbackLock() {
  if (videoElement && !videoElement.paused) {
    videoElement.pause();
    fallbackActive = false;
    setStatus(statusMessages.inactive);
    return true;
  }
  return false;
}

export function isWakeLockActive() {
  if (wakeLock) return true;
  if (fallbackActive && videoElement && !videoElement.paused) return true;
  return false;
}

function logDebug(message, context = {}) {
  if (!debugLogs) return;
  try {
    logger.debug(message, context);
  } catch (e) {
    // fallback to console to avoid breaking flow
    console.debug(message, context);
  }
}
