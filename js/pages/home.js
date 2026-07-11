// home.js — dashboard page
import { data } from '../data.js';
import { teamFullNames, teamBadgeImg, escQ } from '../util.js';

function renderHome() {
  const container = document.getElementById('home-content');

  const hot = data.seasonToDate.filter(p => p.streak === '🔥 Hot')
    .sort((a,b) => b.pts_delta - a.pts_delta).slice(0,5);
  const cold = data.seasonToDate.filter(p => p.streak === '🧊 Cold')
    .sort((a,b) => a.pts_delta - b.pts_delta).slice(0,5);

  const attPlayers = data.ratings.filter(p => p.season_ok && ['MID','FWD'].includes(p.position));
  const topGoal = [...attPlayers].sort((a,b) => (b.season_goal_score||0) - (a.season_goal_score||0)).slice(0,5);
  const topCreative = [...attPlayers].sort((a,b) => (b.season_creative_score||0) - (a.season_creative_score||0)).slice(0,5);

  const defPlayers = data.ratings.filter(p => p.season_ok && ['GKP','DEF'].includes(p.position));
  const topCS = [...defPlayers].sort((a,b) => (b.season_cs_score||0) - (a.season_cs_score||0)).slice(0,5);

  const topPPG = data.ratings.filter(p => p.season_ok)
    .sort((a,b) => (b.season_ppg||0) - (a.season_ppg||0)).slice(0,5);

  const topXGShare = data.metrics.filter(p => p.xg_share_4gw)
    .sort((a,b) => b.xg_share_4gw - a.xg_share_4gw).slice(0,5);

  function dashRow(p, valueHtml, onClick) {
    const r = data.ratings.find(x => x.web_name === p.web_name) || p;
    const photo = r.code ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${r.code}.png` : '';
    const pos = r.position || p.position || '';
    const team = r.team || p.team || '';
    return `<div class="dashboard-row" onclick="${onClick}">
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
        ${players.map((p,i) => { p._rank = i+1; return dashRow(p, valueFn(p), `showPlayerFromRankings('${escQ(p.web_name)}')`); }).join('')}
      </div>
    </div>`;
  }

  container.innerHTML = `
    <div class="dashboard-grid">
      ${dashCard('🔥 Hot Streak', '🔥', hot, p => `+${Number(p.pts_delta).toFixed(1)}`)}
      ${dashCard('🧊 Cold Streak', '🧊', cold, p => `${Number(p.pts_delta).toFixed(1)}`)}
      ${dashCard('⚽ Top Goal Threats', '⚽', topGoal, p => p.season_goal_score_rating || 'N/A')}
      ${dashCard('🎯 Top Creators', '🎯', topCreative, p => p.season_creative_score_rating || 'N/A')}
      ${dashCard('🛡️ Top Clean Sheets', '🛡️', topCS, p => p.season_cs_score_rating || 'N/A')}
      ${dashCard('💰 Top PPG', '💰', topPPG, p => p.season_ppg ? p.season_ppg.toFixed(1) + ' ppg' : 'N/A')}
      ${dashCard('📊 Top xG Share', '📊', topXGShare, p => p.xg_share_4gw ? (p.xg_share_4gw*100).toFixed(1)+'%' : 'N/A')}
    </div>
  `;
}

export { renderHome };
