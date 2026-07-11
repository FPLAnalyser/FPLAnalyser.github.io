// myteam.js — Load Your Team page: squad view + the insight report
import { data } from '../data.js';
import { teamFullNames, escQ, avgRatingField, fixtureChips } from '../util.js';
import { fplFetch, getGwForTeam, fetchEntryHistory } from '../api.js';
import { buildContext, runRules, SEVERITY_META } from '../insights/engine.js';
import { RULES } from '../insights/rules.js';

const TEAM_ID_KEY = 'fpl_team_id';

// Prefill (and auto-load) the last-used team ID
function initMyTeam() {
  const saved = localStorage.getItem(TEAM_ID_KEY);
  if (!saved) return;
  const input = document.getElementById('team-id-input');
  input.value = saved;
  loadMyTeam();
}

async function loadMyTeam() {
  const input = document.getElementById('team-id-input');
  const teamId = input.value.trim();
  const container = document.getElementById('loadteam-result');

  if (!teamId || !/^\d+$/.test(teamId)) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div>Please enter a valid numeric Team ID</div></div>`;
    return;
  }

  container.innerHTML = `<div class="loading"><div class="loading-spinner"></div>Loading your team...</div>`;

  try {
    const gw = await getGwForTeam(teamId);
    const [picksRes, historyData] = await Promise.all([
      fplFetch(`https://fantasy.premierleague.com/api/entry/${teamId}/event/${gw}/picks/`),
      fetchEntryHistory(teamId)
    ]);
    const picksData = await picksRes.json();
    localStorage.setItem(TEAM_ID_KEY, teamId);
    renderMyTeam(picksData, gw, historyData);
  } catch (e) {
    console.error('Load team error:', e);
    const detail = (e && e.message ? e.message : String(e)).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div>Could not load your team. Double-check the Team ID, or your browser/network may be blocking the request to the FPL API.</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2);margin-top:12px;word-break:break-word;">${detail}</div>
      </div>
    `;
  }
}

// Build the "Your Report" section by running the insight rules over the squad
function buildReportHtml(picksData, historyData) {
  const ctx = buildContext(picksData, historyData, {
    ratings: data.ratings,
    personas4: data.personas4,
    seasonToDate: data.seasonToDate,
    playerForm: data.playerForm,
    priceRisk: data.priceRisk,
    personaShifts: data.personaShifts,
    teamMetrics: data.teamMetrics,
    benchmarks: data.benchmarks,
    replacementPool: data.replacementPool,
    fixtureEase: data.fixtureEase,
  });
  const insights = runRules(RULES, ctx);

  if (!insights.length) {
    return `<div class="section-header">Your Report</div>
      <div class="insight-card" style="--sev:#38D9A9">
        <div class="insight-headline">No alerts this week — your squad looks healthy 🟢</div>
        <div class="insight-body">Every starter is minutes-secure and every position group is holding up against the league benchmarks. Check back after the next gameweek.</div>
      </div>`;
  }

  const suggestionCard = (s) => `
    <div class="suggestion-card" onclick="event.stopPropagation();showPlayerFromRankings('${escQ(s.web_name)}')">
      ${s.code ? `<img src="https://resources.premierleague.com/premierleague/photos/players/110x140/p${s.code}.png" onerror="this.style.opacity='0'">` : ''}
      <div class="suggestion-info">
        <div class="suggestion-name">${s.web_name} <span style="color:var(--text2);font-weight:400">£${Number(s.price).toFixed(1)}m · ${s.team}</span></div>
        <div class="suggestion-reason">${s.reason}</div>
      </div>
    </div>`;

  return `<div class="section-header">Your Report</div>
    ${insights.map(i => {
      const meta = SEVERITY_META[i.severity] || SEVERITY_META.info;
      return `<div class="insight-card" style="--sev:${meta.color}">
        <div class="insight-headline">${meta.icon} ${i.headline}</div>
        <div class="insight-body">${i.body}</div>
        <div class="insight-evidence">${i.evidence}</div>
        ${i.suggestions && i.suggestions.length ? `<div class="suggestion-row">${i.suggestions.map(suggestionCard).join('')}</div>` : ''}
      </div>`;
    }).join('')}`;
}

function renderMyTeam(picksData, gw, historyData) {
  const container = document.getElementById('loadteam-result');
  const picks = picksData.picks || [];
  const entryHistory = picksData.entry_history || {};

  if (!picks.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div>No squad data found for that Team ID / gameweek ${gw}.</div></div>`;
    return;
  }

  const enriched = picks.map(pick => ({
    pick,
    r: data.ratings.find(x => x.element === pick.element),
    p4: data.personas4.find(x => x.element === pick.element),
    std: data.seasonToDate.find(x => x.element === pick.element)
  }));

  const startingXI = enriched.filter(e => e.pick.position <= 11).sort((a, b) => a.pick.position - b.pick.position);
  const bench = enriched.filter(e => e.pick.position > 11).sort((a, b) => a.pick.position - b.pick.position);

  const startingRated = startingXI.map(e => e.r).filter(Boolean);
  const reliabilityAvg = avgRatingField(startingRated, 'season_reliability_score_rating');
  const goalAvg = avgRatingField(startingRated.filter(r => ['MID', 'FWD'].includes(r.position)), 'season_goal_score_rating');
  const csAvg = avgRatingField(startingRated.filter(r => ['GKP', 'DEF'].includes(r.position)), 'season_cs_score_rating');
  const overallAvg = avgRatingField(startingRated, 'season_overall_rating');
  const teamValue = entryHistory.value != null ? (entryHistory.value / 10).toFixed(1) : 'N/A';

  // Next 3 fixtures for a team, FDR-coloured (shared helper in util.js)
  function nextFixturesHtml(team) {
    const chips = fixtureChips(data.fixtureEase, team, 3);
    return chips ? `<div class="pitch-card-fixt">${chips}</div>` : '';
  }

  function pitchCard({ pick, r, p4, std }, isBench) {
    if (!r) {
      return `<div class="pitch-card ${isBench ? 'bench' : ''}">
        <div class="pitch-card-name">Unknown (ID ${pick.element})</div>
      </div>`;
    }

    const photo = r.code ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${r.code}.png` : '';
    const streak = std ? std.streak : '';
    const streakIcon = streak === '🔥 Hot' ? '🔥' : streak === '🧊 Cold' ? '🧊' : '';
    const streakLabel = streak === '🔥 Hot' ? 'Hot Streak' : streak === '🧊 Cold' ? 'Cold Streak' : '';
    const personas = p4 && p4.personas && p4.personas !== 'None' ? p4.personas.split(', ') : [];

    const tooltip = `
      <span class="tooltip-box">
        <strong>${r.web_name}</strong> · ${r.position} · ${teamFullNames[r.team] || r.team} · £${r.price}m<br>
        Season: ${r.season_overall_rating || 'N/A'} · 4GW: ${r.gw4_overall_rating || 'N/A'}
        ${streakLabel ? ' · ' + streakLabel : ''}
        ${personas.length ? '<br>' + personas.join(', ') : ''}
      </span>
    `;

    return `
      <div class="pitch-card tooltip-wrap ${isBench ? 'bench' : ''}" onclick="showPlayerFromRankings('${escQ(r.web_name)}')">
        ${pick.is_captain ? '<span class="pitch-armband">C</span>' : ''}
        ${pick.is_vice_captain ? '<span class="pitch-armband vc">V</span>' : ''}
        ${streakIcon ? `<span class="pitch-streak">${streakIcon}</span>` : ''}
        <img class="pitch-card-photo" src="${photo}" onerror="this.style.opacity='0'">
        <div class="pitch-card-name">${r.web_name}</div>
        <div class="pitch-card-meta">${r.position} · £${r.price}m</div>
        ${nextFixturesHtml(r.team)}
        <div class="pitch-card-l4">L4: ${r.gw4_overall_rating || 'N/A'}</div>
        <div class="pitch-card-l4">N4: ${r.next4_overall_rating || 'N/A'}</div>
        <div class="pitch-card-footer">${r.season_overall_rating || 'N/A'}</div>
        ${tooltip}
      </div>
    `;
  }

  function pitchRow(rows, isBench) {
    if (!rows.length) return '';
    return `<div class="pitch-row">${rows.map(e => pitchCard(e, isBench)).join('')}</div>`;
  }

  const posGroups = [
    startingXI.filter(e => e.r && e.r.position === 'GKP'),
    startingXI.filter(e => e.r && e.r.position === 'DEF'),
    startingXI.filter(e => e.r && e.r.position === 'MID'),
    startingXI.filter(e => e.r && e.r.position === 'FWD'),
    startingXI.filter(e => !e.r),
  ];

  container.innerHTML = `
    <div class="section-header">Team Ratings</div>
    <div class="team-stats-row" style="flex-wrap:wrap;gap:24px 32px;margin-bottom:8px;">
      <div class="team-stat">
        <div class="team-stat-value">${overallAvg !== null ? overallAvg.toFixed(1) + ' ★' : 'N/A'}</div>
        <div class="team-stat-label">Avg Overall Rating</div>
      </div>
      <div class="team-stat">
        <div class="team-stat-value">${reliabilityAvg !== null ? reliabilityAvg.toFixed(1) + ' ★' : 'N/A'}</div>
        <div class="team-stat-label">Avg Reliability (XI)</div>
      </div>
      <div class="team-stat">
        <div class="team-stat-value">${goalAvg !== null ? goalAvg.toFixed(1) + ' ★' : 'N/A'}</div>
        <div class="team-stat-label">Avg Goal Threat (MID/FWD)</div>
      </div>
      <div class="team-stat">
        <div class="team-stat-value">${csAvg !== null ? csAvg.toFixed(1) + ' ★' : 'N/A'}</div>
        <div class="team-stat-label">Avg Clean Sheet (GKP/DEF)</div>
      </div>
      <div class="team-stat">
        <div class="team-stat-value">£${teamValue}m</div>
        <div class="team-stat-label">Total Team Value</div>
      </div>
    </div>

    ${buildReportHtml(picksData, historyData)}

    <div class="section-header">Starting XI — Gameweek ${gw}</div>
    <div class="pitch">
      <div class="pitch-box"></div>
      ${posGroups.map(rows => pitchRow(rows, false)).join('')}
    </div>

    <div class="bench-strip">
      <div class="bench-strip-label">Bench</div>
      <div class="pitch-row">${bench.map(e => pitchCard(e, true)).join('')}</div>
    </div>
  `;
}

window.loadMyTeam = loadMyTeam;
export { loadMyTeam, initMyTeam };
