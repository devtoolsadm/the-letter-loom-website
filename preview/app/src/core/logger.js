const LOG_CHANNEL_NAME = "app-logs";
const MAX_LOGS = 200;

const logs = [];
const listeners = new Set();
let channel = null;

if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  channel = new BroadcastChannel(LOG_CHANNEL_NAME);
  channel.onmessage = (event) => {
    const entry = event.data;
    if (entry && entry.type === "log-entry" && entry.source !== "ui") {
      pushLog(entry, true);
    }
  };
}

function pushLog(entry, emit = true) {
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
  if (emit) {
    listeners.forEach((cb) => {
      try {
        cb(entry);
      } catch (err) {
        console.error("Log listener failed", err);
      }
    });
  }
}

function makeEntry(level, message, context) {
  return {
    type: "log-entry",
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: Date.now(),
    level,
    message,
    context: context || null,
    source: "ui",
  };
}

export function log(level, message, context) {
  const entry = makeEntry(level, message, context);
  pushLog(entry);
  if (channel) {
    channel.postMessage(entry);
  }
  const consoleMethod = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[consoleMethod](`[${level.toUpperCase()}] ${message}`, context || "");
}

export const logger = {
  log: (message, context) => log("info", message, context),
  info: (message, context) => log("info", message, context),
  warn: (message, context) => log("warn", message, context),
  error: (message, context) => log("error", message, context),
  debug: (message, context) => log("debug", message, context),
};

export function onLog(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getLogs() {
  return logs.slice();
}
