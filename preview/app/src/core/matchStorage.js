const ACTIVE_KEY = "letterloom_match_active";
const ARCHIVE_KEY = "letterloom_match_archive";
const RECORDS_KEY = "letterloom_match_records";

const ARCHIVE_LIMIT = 10;
const RESUME_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

export function getResumeMaxAgeMs() {
  return RESUME_MAX_AGE_MS;
}

export function loadActiveMatch() {
  const raw = localStorage.getItem(ACTIVE_KEY);
  return safeParse(raw);
}

export function saveActiveMatch(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(snapshot));
}

export function clearActiveMatch() {
  localStorage.removeItem(ACTIVE_KEY);
}

export function loadArchive() {
  const raw = localStorage.getItem(ARCHIVE_KEY);
  const parsed = safeParse(raw);
  if (!parsed || typeof parsed !== "object") {
    return { order: [], byId: {} };
  }
  const order = Array.isArray(parsed.order) ? parsed.order : [];
  const byId = parsed.byId && typeof parsed.byId === "object" ? parsed.byId : {};
  return { order, byId };
}

export function saveArchive(archive) {
  if (!archive || typeof archive !== "object") return;
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
}

export function loadRecords() {
  const raw = localStorage.getItem(RECORDS_KEY);
  const parsed = safeParse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function recordValueHasMatch(value, matchId) {
  if (!value) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => recordValueHasMatch(entry, matchId));
  }
  if (typeof value === "object") {
    if (String(value.matchId || "") === String(matchId)) return true;
    return Object.values(value).some((entry) => recordValueHasMatch(entry, matchId));
  }
  return false;
}

export function matchHasRecord(matchId, records = null) {
  if (!matchId) return false;
  const data = records || loadRecords();
  return recordValueHasMatch(data, matchId);
}

export function normalizeMatchForResume(matchState) {
  if (!matchState || typeof matchState !== "object") return matchState;
  const next = clone(matchState);
  const phase = String(next.phase || "");
  if (phase.startsWith("strategy")) {
    next.remaining = Number(next.strategySeconds) || 0;
  } else if (phase.startsWith("creation")) {
    next.remaining = Number(next.creationSeconds) || 0;
  } else if (phase === "config") {
    next.remaining = 0;
  }
  return next;
}

export function isResumeEligible(snapshot, now = Date.now()) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (snapshot.status !== "active") return false;
  if (snapshot.exitExplicit) return false;
  if (!snapshot.lastSavedAt) return false;
  return now - snapshot.lastSavedAt <= RESUME_MAX_AGE_MS;
}

export function upsertArchiveMatch(snapshot, { records = null } = {}) {
  if (!snapshot || !snapshot.matchId) return;
  const archive = loadArchive();
  const matchId = String(snapshot.matchId);
  const entry = {
    matchId,
    savedAt: snapshot.savedAt || snapshot.lastSavedAt || Date.now(),
    status: snapshot.status || "finished",
    matchState: snapshot.matchState || null,
  };
  archive.byId[matchId] = entry;
  archive.order = [matchId, ...archive.order.filter((id) => String(id) !== matchId)];

  const recordsData = records || loadRecords();
  const keepIds = new Set();
  archive.order.forEach((id) => {
    const hasRecord = matchHasRecord(id, recordsData);
    if (hasRecord) keepIds.add(String(id));
  });

  let keptRecent = 0;
  const nextOrder = [];
  for (const id of archive.order) {
    const key = String(id);
    if (keepIds.has(key)) {
      nextOrder.push(key);
      continue;
    }
    if (keptRecent < ARCHIVE_LIMIT) {
      nextOrder.push(key);
      keptRecent += 1;
    }
  }

  const nextById = {};
  nextOrder.forEach((id) => {
    if (archive.byId[id]) nextById[id] = archive.byId[id];
  });

  saveArchive({ order: nextOrder, byId: nextById });
}
