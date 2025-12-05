// wakeLockManager.js
// Gestión multiplataforma del bloqueo de pantalla (Wake Lock API + fallback iOS)

let wakeLock = null;
let video = null;
let statusElement = null;
let userRequestedLock = false; // Track if user requested lock
// Sin referencias a botones

function activateIOSLock() {
    if (video) {
        video.play()
            .then(() => {
                if (statusElement) statusElement.textContent = 'Status: Wake lock active (iOS Video Fallback).';
            })
            .catch(e => {
                if (statusElement) statusElement.textContent = 'Status: Failed to activate video playback for lock.';
                console.error("Failed to play video for wake lock:", e);
            });
    }
}

function releaseIOSLock() {
    if (video && !video.paused) {
        video.pause();
        if (statusElement) statusElement.textContent = 'Status: Wake lock inactive.';
    }
}

function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && wakeLock === null && userRequestedLock) {
        console.log('Visibility changed. Attempting to re-acquire lock.');
        requestLock();
    }
}

export function initWakeLockManager({ videoElement, statusEl }) {
    video = videoElement;
    statusElement = statusEl;
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

export async function requestLock() {
    userRequestedLock = true;
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                console.log('System released the standard wake lock.');
                if (statusElement) statusElement.textContent = 'Status: Lock released by system. Please restart.';
            });
            if (statusElement) statusElement.textContent = 'Status: Wake lock active (Standard API).';
        } catch (err) {
            console.error(`Standard Wake Lock API failed: ${err.name}. Using iOS fallback.`);
            activateIOSLock();
        }
    } else {
        console.log("Standard Wake Lock API not supported. Using iOS fallback.");
        activateIOSLock();
    }
}

export async function releaseLock() {
    userRequestedLock = false;
    if (wakeLock) {
        try {
            await wakeLock.release();
            wakeLock = null;
            if (statusElement) statusElement.textContent = 'Status: Wake lock inactive.';
        } catch (err) {
            console.error('Error releasing standard wake lock:', err);
        }
    } else {
        releaseIOSLock();
    }
}
