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

function makeEntry(level, message, contexts) {
  return {
    type: "log-entry",
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: Date.now(),
    level,
    message,
    context: contexts && contexts.length ? contexts : null,
    source: "ui",
  };
}

function formatForConsole(level, message, contexts) {
  const parts = [`[${level.toUpperCase()}] ${message}`];
  if (contexts && contexts.length) {
    contexts.forEach((ctx) => parts.push(ctx));
  } else {
    parts.push("");
  }
  return parts;
}

export function log(level, message, ...contexts) {
  const entry = makeEntry(level, message, contexts);
  pushLog(entry);
  if (channel) {
    channel.postMessage(entry);
  }
  const consoleMethod = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[consoleMethod](...formatForConsole(level, message, contexts));
}

export const logger = {
  log: (message, ...ctx) => log("info", message, ...ctx),
  info: (message, ...ctx) => log("info", message, ...ctx),
  warn: (message, ...ctx) => log("warn", message, ...ctx),
  error: (message, ...ctx) => log("error", message, ...ctx),
  debug: (message, ...ctx) => log("debug", message, ...ctx),
};

export function onLog(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getLogs() {
  return logs.slice().reverse();
}
