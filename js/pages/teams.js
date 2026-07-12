// teams.js — team list and team page
import { data } from '../data.js';
import { teamFullNames, teamCodes, teamBadgeUrl, teamBadgeImg, escQ } from '../util.js';
import { showPage } from '../nav.js';

// Navigate to the Teams page AND show a team (for links on other pages)
function showTeamFromHome(team) {
  const teamsLink = [...document.querySelectorAll('.nav-links a')].find(a => a.textContent === 'Teams');
  showPage('teams', teamsLink);
  showTeam(team);
  window.scrollTo(0, 0);
}

function renderTeamsDefault() {
  const container = document.getElementById('team-result');

  const teams = data.teamMetrics
    .filter(t => t.window === 'season')
    .sort((a,b) => (teamFullNames[a.team]||a.team).localeCompare(teamFullNames[b.team]||b.team));

  container.innerHTML = `
    <div class="section-header" style="margin-bottom:16px">All Teams</div>
    <table class="rankings-table">
      <thead>
        <tr>
          <th></th>
          <th>Team</th>
          <th>Form</th>
          <th>CS Rate</th>
          <th>Home PPG</th>
          <th>Away PPG</th>
          <th>Top Player</th>
          <th>Season Pts</th>
        </tr>
      </thead>
      <tbody>
        ${teams.map(t => `
          <tr onclick="showTeam('${t.team}')" style="cursor:pointer">
            <td>
              ${teamCodes[t.team] ? `<img src="https://resources.premierleague.com/premierleague/badges/t${teamCodes[t.team]}.png" style="width:24px;height:24px;object-fit:contain;vertical-align:middle;">` : ''}
            </td>
            <td><span class="clickable-name">${teamFullNames[t.team] || t.team}</span></td>
            <td style="font-size:12px">${t.form_direction}</td>
            <td style="font-family:'JetBrains Mono',monospace">${(t.cs_rate*100).toFixed(0)}%</td>
            <td style="font-family:'JetBrains Mono',monospace">${t.home_pts_per_gw}</td>
            <td style="font-family:'JetBrains Mono',monospace">${t.away_pts_per_gw}</td>
            <td style="color:var(--accent);font-size:13px">${t.top1_player || 'N/A'}</td>
            <td style="font-family:'JetBrains Mono',monospace;color:var(--accent)">${Math.round(t.total_pts)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ── Team Page ─────────────────────────────────────────────────────────────────
function showTeam(team) {
  document.getElementById('team-dropdown').classList.remove('show');
  document.getElementById('team-search').value = team;

  const seasonData = data.teamMetrics.find(t => t.team === team && t.window === 'season');
  const gw4Data = data.teamMetrics.find(t => t.team === team && t.window === '4gw');
  const players = data.ratings.filter(p => p.team === team && p.season_ok);

  if (!seasonData) return;

  const teamPlayers = players.sort((a, b) => (b.season_overall_score || 0) - (a.season_overall_score || 0));

  document.getElementById('team-result').innerHTML = `
    <div class="player-card team-card">
      <div class="team-header">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:8px;">
        ${teamBadgeUrl(team) ? `
          <img src="${teamBadgeUrl(team)}" alt="${team}" 
            style="width:60px;height:60px;object-fit:contain;"
            onerror="this.style.display='none'">
        ` : ''}
        <div class="team-name">${teamFullNames[team] || team}</div>
      </div>
        <div class="team-stats-row">
          <div class="team-stat">
            <div class="team-stat-value">${Math.round(seasonData.total_pts)}</div>
            <div class="team-stat-label">Season Pts</div>
          </div>
          <div class="team-stat">
            <div class="team-stat-value">${(seasonData.cs_rate * 100).toFixed(0)}%</div>
            <div class="team-stat-label">CS Rate</div>
          </div>
          <div class="team-stat">
            <div class="team-stat-value">${seasonData.home_pts_per_gw}</div>
            <div class="team-stat-label">Home PPG</div>
          </div>
          <div class="team-stat">
            <div class="team-stat-value">${seasonData.away_pts_per_gw}</div>
            <div class="team-stat-label">Away PPG</div>
          </div>
          <div class="team-stat">
            <div class="team-stat-value">${seasonData.form_direction}</div>
            <div class="team-stat-label">Form</div>
          </div>
          <div class="team-stat">
            <div class="team-stat-value">${seasonData.top1_player}</div>
            <div class="team-stat-label">Top Scorer</div>
          </div>
        </div>
      </div>

      <div class="tabs">
        <div class="tab active" onclick="showTab(this, 'team-overview-${team}')">Overview</div>
        <div class="tab" onclick="showTab(this, 'team-players-${team}')">Players</div>
        <div class="tab" onclick="showTab(this, 'team-breakdown-${team}')">Points Breakdown</div>
      </div>

      <div id="team-overview-${team}" class="tab-content active">
        <div class="section-header">Season Points Breakdown</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${(seasonData.goal_pts_pct * 100).toFixed(0)}%</div>
            <div class="stat-label">From Goals</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(seasonData.assist_pts_pct * 100).toFixed(0)}%</div>
            <div class="stat-label">From Assists</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(seasonData.cs_pts_pct * 100).toFixed(0)}%</div>
            <div class="stat-label">From Clean Sheets</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${seasonData.dc_pts ? (seasonData.dc_pts / seasonData.total_pts * 100).toFixed(0) : 0}%</div>
            <div class="stat-label">From Def Contributions</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(seasonData.bonus_pts_pct * 100).toFixed(0)}%</div>
            <div class="stat-label">From Bonus</div>
          </div>
        </div>

        <div class="section-header">Points by Position</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${(seasonData.gkp_pct * 100).toFixed(0)}%</div>
            <div class="stat-label">GKP</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(seasonData.def_pct * 100).toFixed(0)}%</div>
            <div class="stat-label">DEF</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(seasonData.mid_pct * 100).toFixed(0)}%</div>
            <div class="stat-label">MID</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(seasonData.fwd_pct * 100).toFixed(0)}%</div>
            <div class="stat-label">FWD</div>
          </div>
        </div>

        <div class="section-header">Concentration Risk</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${(seasonData.top1_share * 100).toFixed(0)}%</div>
            <div class="stat-label">Top Player Share</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(seasonData.top3_share * 100).toFixed(0)}%</div>
            <div class="stat-label">Top 3 Share</div>
          </div>
        </div>
        <div style="margin-top:12px;">
          ${(() => {
            const teamPlayers = data.ratings
              .filter(p => p.team === team && p.season_ok)
              .sort((a,b) => (b.season_ppg||0) - (a.season_ppg||0));
            const totalPts = seasonData.total_pts;
            return teamPlayers.slice(0,3).map((p,i) => {
              const playerShare = p.season_ppg && p.total_mins
                ? ((p.season_ppg * (p.total_mins/90)) / totalPts * 100).toFixed(1)
                : 'N/A';
              return `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
                <span style="color:var(--text2);font-size:12px;width:20px">#${i+1}</span>
                <span class="clickable-name" onclick="showPlayerFromRankings('${escQ(p.web_name)}')" style="flex:1;margin:0 12px">${p.web_name}</span>
                <span style="font-family:'JetBrains Mono',monospace;color:var(--text2);font-size:12px;margin-right:12px">${playerShare}% of team pts</span>
                <span style="font-family:'JetBrains Mono',monospace;color:var(--accent);font-size:13px">${p.season_ppg ? p.season_ppg.toFixed(1) : 'N/A'} ppg</span>
                <span style="margin-left:12px">${p.season_overall_rating || 'N/A'}</span>
              </div>
            `}).join('');
          })()}
        </div>

        ${gw4Data ? `
        <div class="section-header">Last 4GW Form</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${Math.round(gw4Data.total_pts)}</div>
            <div class="stat-label">Total Pts</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(gw4Data.cs_rate * 100).toFixed(0)}%</div>
            <div class="stat-label">CS Rate</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${gw4Data.form_direction}</div>
            <div class="stat-label">Form</div>
          </div>
        </div>
        ` : ''}
      </div>

      <div id="team-players-${team}" class="tab-content">
        <div class="section-header">Rated Players</div>
        <table class="rankings-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Season Rating</th>
              <th>4GW Rating</th>
              <th>Next 4GW</th>
              <th>PPG</th>
            </tr>
          </thead>
          <tbody>
            ${teamPlayers.map(p => `
              <tr>
                <td><span class="clickable-name" onclick="showPlayerFromRankings('${escQ(p.web_name)}')">${p.web_name}</span></td>
                <td><span class="badge badge-pos">${p.position}</span></td>
                <td>${p.season_overall_rating || 'N/A'}</td>
                <td>${p.gw4_overall_rating || 'N/A'}</td>
                <td>${p.next4_overall_rating || 'N/A'}</td>
                <td style="font-family:'JetBrains Mono',monospace;color:var(--accent)">${p.season_ppg ? p.season_ppg.toFixed(1) : 'N/A'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div id="team-breakdown-${team}" class="tab-content">
        <div class="section-header">xG and xGC</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${seasonData.team_xg ? Number(seasonData.team_xg).toFixed(1) : 'N/A'}</div>
            <div class="stat-label">Season xG</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${seasonData.team_xa ? Number(seasonData.team_xa).toFixed(1) : 'N/A'}</div>
            <div class="stat-label">Season xA</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${seasonData.team_xgc ? Number(seasonData.team_xgc).toFixed(1) : 'N/A'}</div>
            <div class="stat-label">Season xGC</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

window.showTeam = showTeam;
window.showTeamFromHome = showTeamFromHome;
export { renderTeamsDefault, showTeam };
