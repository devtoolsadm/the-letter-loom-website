let wakeLock = null;
let videoElement = null;
let statusElement = null;
let userRequestedLock = false;
let fallbackActive = false;

const defaultStatusMessages = {
  activeStandard: "Status: Wake lock active (standard API).",
  released: "Status: Wake lock released by system.",
  activeFallback: "Status: Wake lock active (fallback video).",
  fallbackFailed: "Status: Wake lock fallback failed (video error).",
  inactive: "Status: Wake lock inactive."
};

let statusMessages = { ...defaultStatusMessages };

export function initWakeLockManager({ videoEl, statusEl, messages }) {
  videoElement = videoEl;
  statusElement = statusEl;
  statusMessages = { ...defaultStatusMessages, ...(messages || {}) };
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function handleVisibilityChange() {
  if (
    document.visibilityState === "visible" &&
    wakeLock === null &&
    userRequestedLock
  ) {
    requestLock();
  }
}

function setStatus(msg) {
  if (statusElement) statusElement.textContent = msg;
}

export async function requestLock() {
  if ("wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        setStatus(statusMessages.released);
        userRequestedLock = false;
        wakeLock = null;
      });
      setStatus(statusMessages.activeStandard);
      userRequestedLock = true;
    } catch (err) {
      console.error(`Standard Wake Lock API failed: ${err.name}. Using fallback.`);
      userRequestedLock = await activateFallbackLock();
    }
  } else {
    userRequestedLock = await activateFallbackLock();
  }
}

async function activateFallbackLock() {
  if (videoElement) {
    try {
      await videoElement.play();
      fallbackActive = true;
      setStatus(statusMessages.activeFallback);
    } catch (e) {
      setStatus(statusMessages.fallbackFailed);
      console.error("Failed to play video for wake lock:", e);
      fallbackActive = false;
    }
  } else {
    fallbackActive = false;
  }
  return fallbackActive;
}

export async function releaseLock() {
  if ("wakeLock" in navigator) {
    if (wakeLock) {
      try {
        await wakeLock.release();
        wakeLock = null;
        setStatus(statusMessages.inactive);
        userRequestedLock = false;
      } catch (err) {
        console.error("Error releasing standard wake lock:", err);
      }
    }
  } else if (fallbackActive) {
    if (releaseFallbackLock()) {
      userRequestedLock = false;
    }
  }
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
  if (!userRequestedLock) return false;
  if (wakeLock) return true;
  if (fallbackActive && videoElement && !videoElement.paused) return true;
  return false;
}
