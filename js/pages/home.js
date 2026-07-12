// home.js — dashboard: what matters this week (fixtures, captaincy, form)
import { data } from '../data.js';
import { teamFullNames, teamBadgeImg, escQ, fixtureChips } from '../util.js';

function metaLine() {
  const m = data.meta;
  if (!m || !m.generated_at) return '';
  const date = new Date(m.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const gw = m.current_gw ? ` · data through GW${m.current_gw}` : '';
  return `Data updated ${date}${gw}`;
}

function dashRow(p, valueHtml) {
  const r = data.ratings.find(x => x.web_name === p.web_name) || p;
  const photo = r.code ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${r.code}.png` : '';
  const pos = r.position || p.position || '';
  const team = r.team || p.team || '';
  return `<div class="dashboard-row" onclick="showPlayerFromRankings('${escQ(p.web_name)}')">
    <span class="dashboard-rank">#${p._rank}</span>
    <img class="dashboard-photo" src="${photo}" onerror="this.style.opacity='0'">
    <div class="dashboard-info">
      <div class="dashboard-name">${p.web_name}</div>
      <div class="dashboard-meta">${pos} · ${teamBadgeImg(team, 12)}${teamFullNames[team] || team}</div>
    </div>
    <span class="dashboard-value">${valueHtml}</span>
  </div>`;
}

function dashCard(title, icon, players, valueFn) {
  return `<div class="dashboard-card">
    <div class="dashboard-card-header">${icon} ${title}</div>
    <div class="dashboard-card-body">
      ${players.map((p, i) => { p._rank = i + 1; return dashRow(p, valueFn(p)); }).join('')}
    </div>
  </div>`;
}

// "This Gameweek" panel — only meaningful when upcoming fixtures exist
function gwPanel() {
  const m = data.meta;
  const nextGw = m && m.next_gw;
  if (!nextGw) {
    // Between seasons: recap instead of a weekly panel
    const topRated = data.ratings.filter(p => p.season_ok)
      .sort((a, b) => (b.season_overall_score || 0) - (a.season_overall_score || 0)).slice(0, 5);
    const topPPG = data.ratings.filter(p => p.season_ok)
      .sort((a, b) => (b.season_ppg || 0) - (a.season_ppg || 0)).slice(0, 5);
    return `<div class="gw-panel">
      <div class="gw-panel-title">Season complete 🏁</div>
      <div class="gw-panel-sub">${metaLine()} — the weekly panel (deadline, captaincy picks, fixture swings) switches on when next season's fixtures land.</div>
      <div class="home-columns">
        ${dashCard('Season Top Rated', '⭐', topRated, p => p.season_overall_rating || 'N/A')}
        ${dashCard('Season Top PPG', '💰', topPPG, p => p.season_ppg ? p.season_ppg.toFixed(1) + ' ppg' : 'N/A')}
      </div>
    </div>`;
  }

  // Deadline estimate: 90 minutes before the earliest kickoff of the next GW
  const gwFixtures = (data.fixtureEase || []).filter(f => f.gw === nextGw && f.kickoff);
  let deadlineHtml = '';
  const kickoffs = gwFixtures.map(f => new Date(f.kickoff)).filter(d => !isNaN(d));
  if (kickoffs.length) {
    const deadline = new Date(Math.min(...kickoffs) - 90 * 60000);
    deadlineHtml = ` · deadline ~${deadline.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  }

  const captains = data.ratings.filter(p => p.season_ok && p.next4_score)
    .sort((a, b) => (b.next4_score || 0) - (a.next4_score || 0)).slice(0, 5);

  return `<div class="gw-panel">
    <div class="gw-panel-title">Gameweek ${nextGw}</div>
    <div class="gw-panel-sub">${metaLine()}${deadlineHtml}</div>
    ${captains.length ? dashCard('Captaincy Shortlist — form × fixtures (next 4 GWs)', '🎖️', captains,
      p => `${p.next4_overall_rating || 'N/A'}${p.next4_fixture_factor ? ` <span style="color:var(--text2);font-size:11px">×${Number(p.next4_fixture_factor).toFixed(2)}</span>` : ''}`) : ''}
  </div>`;
}

// Fixture ticker — every team's next 3, easiest run first
function fixtureTicker() {
  const ease = data.fixtureEase || [];
  if (!ease.length) return '';
  const teams = [...new Set(ease.map(f => f.team))];
  const rows = teams.map(team => {
    const next = ease.filter(f => f.team === team).sort((a, b) => a.gw - b.gw).slice(0, 3);
    const avgEase = next.reduce((s, f) => s + (f.att_ease || 1), 0) / (next.length || 1);
    return { team, avgEase };
  }).sort((a, b) => b.avgEase - a.avgEase);

  return `<div class="section-header">Fixture Ticker — next 3, easiest run first</div>
  <table class="ticker-table" style="margin-bottom:24px">
    <tbody>
      ${rows.map(r => `<tr onclick="showTeamFromHome('${r.team}')">
        <td class="ticker-team">${teamBadgeImg(r.team, 16)}${teamFullNames[r.team] || r.team}</td>
        <td><div class="ticker-chips">${fixtureChips(data.fixtureEase, r.team, 3)}</div></td>
        <td class="ticker-ease" style="color:${r.avgEase >= 1 ? 'var(--accent)' : 'var(--hot)'}" title="Attack ease vs league average over the next 3 (higher = kinder fixtures)">×${r.avgEase.toFixed(2)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function formWatch() {
  const hot = data.seasonToDate.filter(p => p.streak === '🔥 Hot')
    .sort((a, b) => b.pts_delta - a.pts_delta).slice(0, 5);
  const cold = data.seasonToDate.filter(p => p.streak === '🧊 Cold')
    .sort((a, b) => a.pts_delta - b.pts_delta).slice(0, 5);
  if (!hot.length && !cold.length) return '';
  return `<div class="section-header">Form Watch</div>
  <div class="home-columns">
    ${dashCard('Hot Streak', '🔥', hot, p => `+${Number(p.pts_delta).toFixed(1)}`)}
    ${dashCard('Cold Streak', '🧊', cold, p => `${Number(p.pts_delta).toFixed(1)}`)}
  </div>`;
}

function renderHome() {
  const container = document.getElementById('home-content');
  container.innerHTML = `
    ${gwPanel()}
    ${fixtureTicker()}
    ${formWatch()}
  `;
}

export { renderHome };
