// api.js — live FPL API access through CORS proxies
// ── Load Your Team ───────────────────────────────────────────────────────────
let bootstrapCache = null;

// The FPL API doesn't send CORS headers for cross-origin browser requests,
// so calls are routed through a public CORS proxy, with a fallback if the
// first one is down.
const CORS_PROXY_PRIMARY = 'https://corsproxy.io/?';
const CORS_PROXY_FALLBACK = 'https://api.allorigins.win/raw?url=';

async function fplFetch(url) {
  let primaryError;
  try {
    const res = await fetch(CORS_PROXY_PRIMARY + url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) {
    primaryError = e.message || String(e);
  }
  try {
    const res = await fetch(CORS_PROXY_FALLBACK + encodeURIComponent(url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) {
    const fallbackError = e.message || String(e);
    throw new Error(`corsproxy.io failed (${primaryError}); allorigins.win failed (${fallbackError})`);
  }
}

// bootstrap-static is several MB (every player, team and fixture), which
// exceeds the response size cap on public CORS proxies. The entry endpoint
// returns the manager's current gameweek directly in a tiny payload, so it's
// used first; bootstrap-static is only a fallback for entries with no picks
// yet (e.g. pre-season).
async function getCurrentGwFallback() {
  if (!bootstrapCache) {
    const res = await fplFetch('https://fantasy.premierleague.com/api/bootstrap-static/');
    bootstrapCache = await res.json();
  }
  const events = bootstrapCache.events || [];
  const current = events.find(e => e.is_current);
  if (current) return current.id;
  const finished = events.filter(e => e.finished);
  if (finished.length) return Math.max(...finished.map(e => e.id));
  return events.length ? events[0].id : 1;
}

// Full entry payload: manager name, current GW, classic league memberships
async function fetchEntry(teamId) {
  const entryRes = await fplFetch(`https://fantasy.premierleague.com/api/entry/${teamId}/`);
  return entryRes.json();
}

async function getGwForTeam(teamId) {
  const entryData = await fetchEntry(teamId);
  if (entryData.current_event) return entryData.current_event;
  return getCurrentGwFallback();
}

// Classic league standings (first page: top 50)
async function fetchLeagueStandings(leagueId) {
  const res = await fplFetch(`https://fantasy.premierleague.com/api/leagues-classic/${leagueId}/standings/`);
  return res.json();
}

// A manager's picks for a GW, cached in sessionStorage (rival squads don't
// change mid-GW, and public CORS proxies rate-limit quickly)
async function fetchPicksCached(teamId, gw) {
  const key = `fpl_picks_${teamId}_${gw}`;
  try {
    const hit = sessionStorage.getItem(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* storage unavailable — fetch fresh */ }
  const res = await fplFetch(`https://fantasy.premierleague.com/api/entry/${teamId}/event/${gw}/picks/`);
  const json = await res.json();
  try { sessionStorage.setItem(key, JSON.stringify(json)); } catch (e) { /* quota — fine */ }
  return json;
}

// Season history for a manager: per-GW points, bench points, chips used.
// Non-fatal — the report just skips history-based insights if this fails.
async function fetchEntryHistory(teamId) {
  try {
    const res = await fplFetch(`https://fantasy.premierleague.com/api/entry/${teamId}/history/`);
    return await res.json();
  } catch (e) {
    console.warn('entry history unavailable:', e.message || e);
    return null;
  }
}

export { fplFetch, getCurrentGwFallback, getGwForTeam, fetchEntryHistory,
         fetchEntry, fetchLeagueStandings, fetchPicksCached };
