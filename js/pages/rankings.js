// rankings.js — rankings tables
import { data, loaded } from '../data.js';
import { teamBadgeImg, escQ, icon, renderStars } from '../util.js';

// ── Rankings ──────────────────────────────────────────────────────────────────
let currentRankingsTab = 'top-rated';
let currentPos = 'ALL';

function showRankingsTab(tab, el) {
  currentRankingsTab = tab;
  currentPos = 'ALL';
  document.querySelectorAll('#page-rankings .rankings-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderRankings();
}

function filterPos(pos, el) {
  currentPos = pos;
  document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderRankings();
}

function renderRankings() {
  if (!loaded) return;
  const container = document.getElementById('rankings-content');

  let players = data.ratings.filter(p => p.season_ok);
  if (currentPos !== 'ALL') players = players.filter(p => p.position === currentPos);

  const isDefOnly = currentRankingsTab === 'clean-sheets';
  const isAttOnly = currentRankingsTab === 'goal-threats' || currentRankingsTab === 'creators';
  const posFilter = `
    <div class="pos-filter">
      <button class="pos-btn ${currentPos === 'ALL' ? 'active' : ''}" onclick="filterPos('ALL', this)">All</button>
      ${!isAttOnly ? `<button class="pos-btn ${currentPos === 'GKP' ? 'active' : ''}" onclick="filterPos('GKP', this)">GKP</button>` : ''}
      ${!isAttOnly ? `<button class="pos-btn ${currentPos === 'DEF' ? 'active' : ''}" onclick="filterPos('DEF', this)">DEF</button>` : ''}
      ${!isDefOnly ? `<button class="pos-btn ${currentPos === 'MID' ? 'active' : ''}" onclick="filterPos('MID', this)">MID</button>` : ''}
      ${!isDefOnly ? `<button class="pos-btn ${currentPos === 'FWD' ? 'active' : ''}" onclick="filterPos('FWD', this)">FWD</button>` : ''}
    </div>
  `;

  let rows = [];
  let headers = [];

  if (currentRankingsTab === 'top-rated') {
    players.sort((a, b) => (b.season_overall_score || 0) - (a.season_overall_score || 0));
    headers = ['#', 'Player', 'Pos', 'Team', 'Price', 'Season Rating', '4GW Rating', 'PPG'];
    rows = players.slice(0, 30).map((p, i) => `
      <tr>
        <td class="rank-num">${i + 1}</td>
        <td><span class="clickable-name" onclick="showPlayerFromRankings('${escQ(p.web_name)}')">${p.web_name}</span></td>
        <td><span class="badge badge-pos">${p.position}</span></td>
        <td class="t2">${teamBadgeImg(p.team, 14)}${p.team}</td>
        <td class="num">£${p.price}m</td>
        <td>${renderStars(p.season_overall_rating)}</td>
        <td>${renderStars(p.gw4_overall_rating)}</td>
        <td class="num t-brand">${p.season_ppg ? p.season_ppg.toFixed(1) : 'N/A'}</td>
      </tr>
    `);
} else if (currentRankingsTab === 'goal-threats') {
    const attPlayers = data.ratings.filter(p => p.season_ok && ['MID','FWD'].includes(p.position));
    const filtered = currentPos !== 'ALL' && currentPos !== 'GKP' && currentPos !== 'DEF'
      ? attPlayers.filter(p => p.position === currentPos)
      : attPlayers;
    filtered.sort((a, b) => (b.season_goal_score || 0) - (a.season_goal_score || 0));
    headers = ['#', 'Player', 'Pos', 'Team', 'Goal Rating (Pos)', 'Goal Rating (ATT)', 'xG Share 4GW', 'xG Share Season'];
    rows = filtered.slice(0, 30).map((p, i) => {
      const m = data.metrics.find(x => x.web_name === p.web_name);
      const xgShare4gw = m && m.xg_share_4gw ? (m.xg_share_4gw * 100).toFixed(1) + '%' : 'N/A';
      const xgShareSeason = m && m.xg_share_season ? (m.xg_share_season * 100).toFixed(1) + '%' : 'N/A';
      return `<tr>
        <td class="rank-num">${i + 1}</td>
        <td><span class="clickable-name" onclick="showPlayerFromRankings('${escQ(p.web_name)}')">${p.web_name}</span></td>
        <td><span class="badge badge-pos">${p.position}</span></td>
        <td class="t2">${teamBadgeImg(p.team, 14)}${p.team}</td>
        <td>${renderStars(p.season_goal_score_rating)}</td>
        <td>${renderStars(p.season_att_goal_score_rating)}</td>
        <td class="num">${xgShare4gw}</td>
        <td class="num">${xgShareSeason}</td>
      </tr>`;
    });
  } else if (currentRankingsTab === 'creators') {
    const attPlayers = data.ratings.filter(p => p.season_ok && ['MID','FWD'].includes(p.position));
    const filtered = currentPos !== 'ALL' && currentPos !== 'GKP' && currentPos !== 'DEF'
      ? attPlayers.filter(p => p.position === currentPos)
      : attPlayers;
    filtered.sort((a, b) => (b.season_creative_score || 0) - (a.season_creative_score || 0));
    headers = ['#', 'Player', 'Pos', 'Team', 'Creative Rating (Pos)', 'Creative Rating (ATT)', 'xA Share 4GW', 'xA Share Season'];
    rows = filtered.slice(0, 30).map((p, i) => {
      const m = data.metrics.find(x => x.web_name === p.web_name);
      const xaShare4gw = m && m.xa_share_4gw ? (m.xa_share_4gw * 100).toFixed(1) + '%' : 'N/A';
      const xaShareSeason = m && m.xa_share_season ? (m.xa_share_season * 100).toFixed(1) + '%' : 'N/A';
      return `<tr>
        <td class="rank-num">${i + 1}</td>
        <td><span class="clickable-name" onclick="showPlayerFromRankings('${escQ(p.web_name)}')">${p.web_name}</span></td>
        <td><span class="badge badge-pos">${p.position}</span></td>
        <td class="t2">${teamBadgeImg(p.team, 14)}${p.team}</td>
        <td>${renderStars(p.season_creative_score_rating)}</td>
        <td>${renderStars(p.season_att_creative_score_rating)}</td>
        <td class="num">${xaShare4gw}</td>
        <td class="num">${xaShareSeason}</td>
      </tr>`;
    });
} else if (currentRankingsTab === 'clean-sheets') {
    const defPlayers = data.ratings.filter(p => p.season_ok && ['GKP','DEF'].includes(p.position));
    const filtered = currentPos === 'GKP' || currentPos === 'DEF'
      ? defPlayers.filter(p => p.position === currentPos)
      : defPlayers;
    filtered.sort((a, b) => (b.season_cs_score || 0) - (a.season_cs_score || 0));
    headers = ['#', 'Player', 'Pos', 'Team', 'CS Rating', 'Overall Rating'];
    rows = filtered.slice(0, 30).map((p, i) => `
      <tr>
        <td class="rank-num">${i + 1}</td>
        <td><span class="clickable-name" onclick="showPlayerFromRankings('${escQ(p.web_name)}')">${p.web_name}</span></td>
        <td><span class="badge badge-pos">${p.position}</span></td>
        <td class="t2">${teamBadgeImg(p.team, 14)}${p.team}</td>
        <td>${renderStars(p.season_cs_score_rating)}</td>
        <td>${renderStars(p.season_overall_rating)}</td>
      </tr>
    `);
  } else if (currentRankingsTab === 'next4') {
    const rated = players.filter(p => p.next4_score);
    if (!rated.length) {
      container.innerHTML = `${posFilter}<div class="empty-state"><div class="empty-icon">${icon('calendar', 44)}</div>
        <div>Next 4 GW ratings aren't available yet — they appear once upcoming fixtures exist for the season.</div></div>`;
      return;
    }
    rated.sort((a, b) => (b.next4_score || 0) - (a.next4_score || 0));
    headers = ['#', 'Player', 'Pos', 'Team', 'Next 4GW Rating', 'Fixture Ease', 'Season Rating', '4GW Rating'];
    rows = rated.slice(0, 30).map((p, i) => `
      <tr>
        <td class="rank-num">${i + 1}</td>
        <td><span class="clickable-name" onclick="showPlayerFromRankings('${escQ(p.web_name)}')">${p.web_name}</span></td>
        <td><span class="badge badge-pos">${p.position}</span></td>
        <td class="t2">${teamBadgeImg(p.team, 14)}${p.team}</td>
        <td>${renderStars(p.next4_overall_rating)}</td>
        <td class="num ${p.next4_fixture_factor >= 1 ? 't-good' : 't-bad'}">${p.next4_fixture_factor ? '×' + Number(p.next4_fixture_factor).toFixed(2) : 'N/A'}</td>
        <td>${renderStars(p.season_overall_rating)}</td>
        <td>${renderStars(p.gw4_overall_rating)}</td>
      </tr>
    `);
  } else if (currentRankingsTab === 'value') {
    players.sort((a, b) => (b.season_value_score || 0) - (a.season_value_score || 0));
    headers = ['#', 'Player', 'Pos', 'Team', 'Price', 'Value Rating', 'PPG'];
    rows = players.slice(0, 30).map((p, i) => `
      <tr>
        <td class="rank-num">${i + 1}</td>
        <td><span class="clickable-name" onclick="showPlayerFromRankings('${escQ(p.web_name)}')">${p.web_name}</span></td>
        <td><span class="badge badge-pos">${p.position}</span></td>
        <td class="t2">${teamBadgeImg(p.team, 14)}${p.team}</td>
        <td class="num">£${p.price}m</td>
        <td>${renderStars(p.season_value_score_rating)}</td>
        <td class="num t-brand">${p.season_ppg ? p.season_ppg.toFixed(1) : 'N/A'}</td>
      </tr>
    `);
  } else if (currentRankingsTab === 'form') {
    const stdData = data.seasonToDate;
    const hot = stdData.filter(p => p.streak === '🔥 Hot').sort((a,b) => b.pts_delta - a.pts_delta);
    const cold = stdData.filter(p => p.streak === '🧊 Cold').sort((a,b) => a.pts_delta - b.pts_delta);

    container.innerHTML = `
      ${posFilter}
      <div class="form-section">
        <div>
          <div class="section-header">${icon('flame', 13)} Hot Streak Players</div>
          <table class="rankings-table">
            <thead><tr><th>Player</th><th>Pos</th><th>Season P90</th><th>4GW P90</th><th>Delta</th></tr></thead>
            <tbody>
              ${hot.filter(p => currentPos === 'ALL' || p.position === currentPos).slice(0,15).map(p => `
                <tr>
                  <td><span class="clickable-name" onclick="showPlayerFromRankings('${escQ(p.web_name)}')">${p.web_name}</span></td>
                  <td><span class="badge badge-pos">${p.position}</span></td>
                  <td class="num">${Number(p.pts_per90_season).toFixed(2)}</td>
                  <td class="num">${Number(p.pts_per90_4gw).toFixed(2)}</td>
                  <td class="num t-hot">+${Number(p.pts_delta).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div>
          <div class="section-header">${icon('snow', 13)} Cold Streak Players</div>
          <table class="rankings-table">
            <thead><tr><th>Player</th><th>Pos</th><th>Season P90</th><th>4GW P90</th><th>Delta</th></tr></thead>
            <tbody>
              ${cold.filter(p => currentPos === 'ALL' || p.position === currentPos).slice(0,15).map(p => `
                <tr>
                  <td><span class="clickable-name" onclick="showPlayerFromRankings('${escQ(p.web_name)}')">${p.web_name}</span></td>
                  <td><span class="badge badge-pos">${p.position}</span></td>
                  <td class="num">${Number(p.pts_per90_season).toFixed(2)}</td>
                  <td class="num">${Number(p.pts_per90_4gw).toFixed(2)}</td>
                  <td class="num t-cold">${Number(p.pts_delta).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    ${posFilter}
    <table class="rankings-table">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

window.showRankingsTab = showRankingsTab;
window.filterPos = filterPos;
export { showRankingsTab, renderRankings };
