// minileague.js — rival analysis for the manager's classic mini-leagues:
// effective ownership among rivals, template players you're missing, your
// differentials, and the captaincy spread.
import { data } from '../data.js';
import { teamBadgeImg, escQ, icon, renderStars } from '../util.js';
import { skeletonTable } from '../fx.js';
import { fetchLeagueStandings, fetchPicksCached } from '../api.js';

const MAX_RIVALS = 10;          // proxy-friendly: 10 picks fetches per analysis
const FETCH_GAP_MS = 250;       // throttle between rival fetches
const TEMPLATE_SHARE = 0.6;     // owned by ≥60% of rivals = template
const DIFF_SHARE = 0.2;         // owned by ≤20% of rivals = your differential

let mlState = null; // { teamId, gw, ownedElements }

// Render the league picker under the squad view. `leagues` comes from the
// entry payload; private classic leagues (league_type 'x') listed first.
function miniLeagueSectionHtml(entryData, teamId, gw, ownedElements) {
  const classic = (entryData && entryData.leagues && entryData.leagues.classic) || [];
  if (!classic.length) return '';
  mlState = { teamId: String(teamId), gw, ownedElements };
  const sorted = [...classic].sort((a, b) =>
    (a.league_type === 'x' ? 0 : 1) - (b.league_type === 'x' ? 0 : 1));
  return `
    <div class="section-header">Mini-League Rivals</div>
    <div style="display:flex;gap:8px;max-width:560px;margin-bottom:8px;flex-wrap:wrap;">
      <select id="ml-select" class="team-id-input" style="flex:1;min-width:220px;">
        ${sorted.map(l => `<option value="${l.id}">${l.name}${l.entry_rank ? ` (you: #${l.entry_rank})` : ''}</option>`).join('')}
      </select>
      <button class="btn-primary" onclick="analyseMiniLeague()">Analyse rivals</button>
    </div>
    <div class="t2" style="font-size:12px;margin-bottom:12px;">
      Compares your squad against the top ${MAX_RIVALS} managers in the league — what they own that you don't, and where you have the edge.
    </div>
    <div id="ml-result"></div>`;
}

async function analyseMiniLeague() {
  const select = document.getElementById('ml-select');
  const result = document.getElementById('ml-result');
  if (!select || !mlState) return;
  const leagueId = select.value;
  const leagueName = select.options[select.selectedIndex].textContent;
  result.innerHTML = skeletonTable(5);

  try {
    const standings = await fetchLeagueStandings(leagueId);
    const rows = (standings.standings && standings.standings.results) || [];
    const rivals = rows.filter(r => String(r.entry) !== mlState.teamId).slice(0, MAX_RIVALS);
    if (!rivals.length) {
      result.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('users', 44)}</div><div>No other managers found in this league yet.</div></div>`;
      return;
    }

    const rivalPicks = [];
    for (const r of rivals) {
      try {
        const p = await fetchPicksCached(r.entry, mlState.gw);
        rivalPicks.push({ rival: r, picks: p.picks || [] });
      } catch (e) {
        console.warn(`rival ${r.entry} picks unavailable:`, e.message || e);
      }
      await new Promise(res => setTimeout(res, FETCH_GAP_MS));
    }
    if (!rivalPicks.length) throw new Error('no rival squads could be fetched (proxy rate limit?)');

    renderMiniLeague(result, leagueName, rivalPicks);
  } catch (e) {
    console.error('mini-league error:', e);
    const detail = (e && e.message ? e.message : String(e)).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    result.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('alert', 44)}</div>
      <div>Couldn't analyse this league — the FPL API may be rate-limiting the proxy. Try again in a minute.</div>
      <div class="num t2" style="font-size:11px;margin-top:12px;">${detail}</div></div>`;
  }
}

function renderMiniLeague(container, leagueName, rivalPicks) {
  const n = rivalPicks.length;
  const counts = new Map();     // element -> rivals owning
  const captains = new Map();   // element -> rival captain count
  rivalPicks.forEach(({ picks }) => {
    picks.forEach(p => {
      counts.set(p.element, (counts.get(p.element) || 0) + 1);
      if (p.is_captain) captains.set(p.element, (captains.get(p.element) || 0) + 1);
    });
  });

  const nameOf = (el) => data.ratings.find(r => r.element === el);
  const rowHtml = (el, extra) => {
    const r = nameOf(el);
    if (!r) return '';
    return `<tr>
      <td><span class="clickable-name" onclick="showPlayerFromRankings('${escQ(r.web_name)}')">${r.web_name}</span></td>
      <td class="t2">${teamBadgeImg(r.team, 14)}${r.team}</td>
      <td><span class="badge badge-pos">${r.position}</span></td>
      <td>${renderStars(r.gw4_overall_rating || r.season_overall_rating, { size: 10, showNum: false })}</td>
      <td class="num t-brand">${extra}</td>
    </tr>`;
  };

  // Template you're missing: high rival ownership, not owned by you
  const template = [...counts.entries()]
    .filter(([el, c]) => c / n >= TEMPLATE_SHARE && !mlState.ownedElements.has(el) && nameOf(el))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  // Your differentials: you own, few rivals do
  const diffs = [...mlState.ownedElements]
    .filter(el => (counts.get(el) || 0) / n <= DIFF_SHARE && nameOf(el))
    .sort((a, b) => (counts.get(a) || 0) - (counts.get(b) || 0))
    .slice(0, 6);

  const capRows = [...captains.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(([el]) => nameOf(el));

  container.innerHTML = `
    <div class="home-columns" style="margin-bottom:20px">
      <div>
        <div class="section-header">Template you're missing — owned by rivals, not you</div>
        ${template.length ? `<table class="rankings-table">
          <thead><tr><th>Player</th><th>Team</th><th>Pos</th><th>Form</th><th>Rival own</th></tr></thead>
          <tbody>${template.map(([el, c]) => rowHtml(el, `${Math.round(c / n * 100)}%`)).join('')}</tbody>
        </table>` : `<div class="t2" style="font-size:13px;padding:8px 0">${icon('check', 13, 't-good')} Nothing — you already own every template player in this league.</div>`}
      </div>
      <div>
        <div class="section-header">Your differentials — your edge over this league</div>
        ${diffs.length ? `<table class="rankings-table">
          <thead><tr><th>Player</th><th>Team</th><th>Pos</th><th>Form</th><th>Rival own</th></tr></thead>
          <tbody>${diffs.map(el => rowHtml(el, `${Math.round((counts.get(el) || 0) / n * 100)}%`)).join('')}</tbody>
        </table>` : `<div class="t2" style="font-size:13px;padding:8px 0">None — your squad matches the league template closely. Rank moves will come from captaincy.</div>`}
      </div>
    </div>
    ${capRows.length ? `
    <div class="section-header">Rival captaincy — who the armbands are on</div>
    <table class="rankings-table" style="max-width:560px;margin-bottom:8px">
      <thead><tr><th>Player</th><th>Team</th><th>Pos</th><th>Form</th><th>Captained by</th></tr></thead>
      <tbody>${capRows.map(([el, c]) => rowHtml(el, `${c} of ${n}`)).join('')}</tbody>
    </table>
    <div class="t2" style="font-size:12px">Matching the majority captain protects your rank; going against it is how you attack. Based on the top ${n} managers in ${leagueName.replace(/\s*\(you.*\)$/, '')}.</div>
    ` : ''}
  `;
}

window.analyseMiniLeague = analyseMiniLeague;
export { miniLeagueSectionHtml };
