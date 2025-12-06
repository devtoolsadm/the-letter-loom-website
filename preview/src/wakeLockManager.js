// wakeLockManager.js
// Gestión multiplataforma del bloqueo de pantalla (Wake Lock API + fallback)

let wakeLock = null;
let videoElement = null;
let statusElement = null;
let userRequestedLock = false; // Track if user requested lock
let fallbackActive = false; // Track if fallback is active

export function initWakeLockManager({ videoEl, statusEl }) {
  videoElement = videoEl;
  statusElement = statusEl;
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function setStatus(msg) {
  if (statusElement) statusElement.textContent = msg;
}

function handleVisibilityChange() {
  if (
    document.visibilityState === "visible" &&
    wakeLock === null &&
    userRequestedLock
  ) {
    console.log("Visibility changed. Attempting to re-acquire lock.");
    requestLock();
  }
}

export async function requestLock() {
  if ("wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        setStatus("Status: Wake lock released by system.");
        userRequestedLock = false;
        wakeLock = null;
      });
      setStatus("Status: Wake lock active (standard API).");
      userRequestedLock = true;
    } catch (err) {
      console.error(
        `Standard Wake Lock API failed: ${err.name}. Using fallback.`
      );
      userRequestedLock = await activateFallbackLock();
    }
  } else {
    console.log("Standard Wake Lock API not supported. Using fallback.");
    userRequestedLock = await activateFallbackLock();
  }
}

async function activateFallbackLock() {
  if (videoElement) {
    try {
      await videoElement.play();
      fallbackActive = true;
      setStatus("Status: Wake lock active (fallback video).");
    } catch (e) {
      setStatus("Status: Wake lock fallback failed (video error).");
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
        setStatus("Status: Wake lock inactive.");
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
    setStatus("Status: Wake lock inactive.");
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
