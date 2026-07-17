// players.js — player search, player card, cross-page navigation to a player
import { data } from '../data.js';
import { teamFullNames, teamBadgeUrl, teamBadgeImg, norm, escQ,
         icon, positionIcon, renderStars, tip, TOOLTIPS } from '../util.js';
import { animateCounters, revealBars } from '../fx.js';
import { buildPlayerBundle, buildPlayerVerdict } from '../insights/narrative.js';
import { radialGauge } from '../viz.js';
import { showPage } from '../nav.js';
import { renderPlayerShotMap } from '../playershotmap.js';
import { renderPlayerZoneMap } from '../playerzonemap.js';

function renderPlayersDefault() {
  const container = document.getElementById('player-result');

  const top25 = data.ratings
    .filter(p => p.season_ok && p.selected_by_percent)
    .sort((a,b) => b.selected_by_percent - a.selected_by_percent)
    .slice(0,25);

  container.innerHTML = `
    <div class="section-header" style="margin-bottom:16px">Most Owned Players</div>
    <div class="ownership-grid">
      ${top25.map((p,i) => {
        const photo = p.code ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png` : '';
        const streak = data.seasonToDate.find(x => x.web_name === p.web_name);
        const streakIcon = streak && streak.streak === '🔥 Hot' ? icon('flame', 12, 't-hot') : streak && streak.streak === '🧊 Cold' ? icon('snow', 12, 't-cold') : '';
        return `<div class="ownership-card lift" onclick="showPlayer('${escQ(p.web_name)}')">
          <img loading="lazy" class="ownership-photo" src="${photo}" onerror="this.style.opacity='0'">
          <div class="ownership-info">
            <div class="ownership-name">${p.web_name} ${streakIcon}</div>
            <div class="ownership-meta">${p.position} · ${teamBadgeImg(p.team, 12)}${teamFullNames[p.team] || p.team} · £${p.price}m</div>
            <div class="ownership-pct">${p.selected_by_percent}% owned</div>
            <div style="margin-top:3px">${renderStars(p.season_overall_rating, { size: 10, showNum: false })}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
}

// ── Player Search ────────────────────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('player-search');
  const dropdown = document.getElementById('player-dropdown');

  input.addEventListener('input', () => {
    const q = norm(input.value.trim());
    if (q.length < 2) { dropdown.classList.remove('show'); return; }

    const matches = data.ratings
      .filter(p => p.web_name && norm(p.web_name).includes(q))
      .slice(0, 8);

    if (matches.length === 0) { dropdown.classList.remove('show'); return; }

    dropdown.innerHTML = matches.map(p => `
      <div class="dropdown-item" onclick="showPlayer('${escQ(p.web_name)}')">
        <span>${p.web_name}</span>
        <span class="dropdown-meta">${p.position} · ${teamBadgeImg(p.team, 12)}${p.team} · £${p.price}m</span>
      </div>
    `).join('');
    dropdown.classList.add('show');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) dropdown.classList.remove('show');
  });

  // Team search
  const teamInput = document.getElementById('team-search');
  const teamDropdown = document.getElementById('team-dropdown');
  const teams = [...new Set(data.teamMetrics.filter(t => t.window === 'season').map(t => t.team))].sort();

  teamInput.addEventListener('input', () => {
    const q = norm(teamInput.value.trim());
    if (q.length < 1) { teamDropdown.classList.remove('show'); return; }

    const matches = teams.filter(t =>
      norm(t).includes(q) || norm(teamFullNames[t] || '').includes(q)
    ).slice(0, 8);
    if (matches.length === 0) { teamDropdown.classList.remove('show'); return; }

    teamDropdown.innerHTML = matches.map(t => `
      <div class="dropdown-item" onclick="showTeam('${t}')">${teamBadgeImg(t, 16)}${teamFullNames[t] || t} <span class="dropdown-meta">${t}</span></div>
    `).join('');
    teamDropdown.classList.add('show');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#team-search') && !e.target.closest('#team-dropdown')) {
      teamDropdown.classList.remove('show');
    }
  });
}

// ── Player Card ──────────────────────────────────────────────────────────────
function showPlayer(name) {
  document.getElementById('player-dropdown').classList.remove('show');
  document.getElementById('player-search').value = name;

  const r = data.ratings.find(p => p.web_name === name);
  const p4 = data.personas4.find(p => p.web_name === name);
  const m = data.metrics.find(p => p.web_name === name);
  const std = data.seasonToDate.find(p => p.web_name === name);

  if (!r) return;

  const pos = r.position;
  const isAtt = pos === 'MID' || pos === 'FWD';
  const streak = std ? std.streak : '';
  const streakHtml = streak === '🔥 Hot'
    ? `<span class="streak-hot">${icon('flame', 13)} Hot Streak</span>`
    : streak === '🧊 Cold'
    ? `<span class="streak-cold">${icon('snow', 13)} Cold Streak</span>`
    : '';

  const personas = p4 ? p4.personas : '';
  const flags = p4 ? p4.flags : '';

  const personaHtml = personas && personas !== 'None'
    ? personas.split(', ').map(p => {
        const tipText = TOOLTIPS.personas[p];
        return `<span class="persona-tag tooltip-wrap">${p}${tipText ? `<span class="tooltip-icon">i</span><span class="tooltip-box">${tipText}</span>` : ''}</span>`;
      }).join('')
    : '';

  const flagHtml = flags
    ? flags.split(', ').map(f => {
        const tipText = TOOLTIPS.personas[f];
        return `<span class="flag-tag tooltip-wrap ${f.includes('Monster') ? 'flag-monster' : 'flag-risk'}">${f}${tipText ? `<span class="tooltip-icon">i</span><span class="tooltip-box">${tipText}</span>` : ''}</span>`;
      }).join('')
    : '';

  // Overall ratings
  const seasonOverall = r.season_overall_rating || 'N/A';
  const gw4Overall = r.gw4_overall_rating || 'N/A';
  const attSeason = r.season_att_overall_rating || 'N/A';
  const attGw4 = r.gw4_att_overall_rating || 'N/A';

  // Dimension ratings by position
  let dimRows = '';
  if (pos === 'GKP') {
    dimRows = buildDimRows([
      ['Save', 'season_save_score_rating', 'gw4_save_score_rating', 'save'],
      ['Clean Sheet', 'season_cs_score_rating', 'gw4_cs_score_rating', 'cs'],
      ['BPS / Bonus', 'season_bps_score_rating', 'gw4_bps_score_rating', 'bps'],
      ['Value', 'season_value_score_rating', 'gw4_value_score_rating', 'value'],
      ['Reliability', 'season_reliability_score_rating', 'gw4_reliability_score_rating', 'reliability'],
      ['90 Mins', 'season_mins90_score_rating', 'gw4_mins90_score_rating', 'mins90'],
    ], r);
  } else if (pos === 'DEF') {
    dimRows = buildDimRows([
      ['Clean Sheet', 'season_cs_score_rating', 'gw4_cs_score_rating', 'cs'],
      ['Def Contribution', 'season_dc_score_rating', 'gw4_dc_score_rating', 'dc'],
      ['Attacking', 'season_attacking_score_rating', 'gw4_attacking_score_rating', 'attacking'],
      ['Set Pieces', 'season_set_piece_score_rating', 'gw4_set_piece_score_rating', 'set_piece'],
      ['BPS / Bonus', 'season_bps_score_rating', 'gw4_bps_score_rating', 'bps'],
      ['Value', 'season_value_score_rating', 'gw4_value_score_rating', 'value'],
      ['Reliability', 'season_reliability_score_rating', 'gw4_reliability_score_rating', 'reliability'],
      ['90 Mins', 'season_mins90_score_rating', 'gw4_mins90_score_rating', 'mins90'],
    ], r);
  } else {
    dimRows = buildDimRows([
      ['Goal Threat', 'season_goal_score_rating', 'gw4_goal_score_rating', 'goal'],
      ['Shot Quality', 'season_shot_quality_score_rating', 'gw4_shot_quality_score_rating', 'shot_quality'],
      ['Finishing Skill', 'season_finishing_skill_score_rating', 'gw4_finishing_skill_score_rating', 'finishing_skill'],
      ['Creativity', 'season_creative_score_rating', 'gw4_creative_score_rating', 'creative'],
      ['Creativity Depth', 'season_creativity_depth_score_rating', 'gw4_creativity_depth_score_rating', 'creativity_depth'],
      ['Set Pieces', 'season_set_piece_score_rating', 'gw4_set_piece_score_rating', 'set_piece'],
      ['Def Contribution', 'season_dc_score_rating', 'gw4_dc_score_rating', 'dc'],
      ['BPS / Bonus', 'season_bps_score_rating', 'gw4_bps_score_rating', 'bps'],
      ['Value', 'season_value_score_rating', 'gw4_value_score_rating', 'value'],
      ['Reliability', 'season_reliability_score_rating', 'gw4_reliability_score_rating', 'reliability'],
      ['90 Mins', 'season_mins90_score_rating', 'gw4_mins90_score_rating', 'mins90'],
    ], r);
  }

  // Attacker combined ratings
  const attDimRows = isAtt ? buildDimRows([
    ['Goal Threat', 'season_att_goal_score_rating', 'gw4_att_goal_score_rating'],
    ['Creativity', 'season_att_creative_score_rating', 'gw4_att_creative_score_rating'],
    ['Def Contribution', 'season_att_dc_score_rating', 'gw4_att_dc_score_rating'],
    ['BPS / Bonus', 'season_att_bps_score_rating', 'gw4_att_bps_score_rating'],
    ['Value', 'season_att_value_score_rating', 'gw4_att_value_score_rating'],
    ['Reliability', 'season_att_reliability_rating', 'gw4_att_reliability_rating'],
    ['90 Mins', 'season_att_mins90_rating', 'gw4_att_mins90_rating'],
  ], r) : '';

  // Advanced metrics
  const sharpe = m ? m.sharpe_4gw : 'N/A';
  const alpha = m ? m.alpha_4gw : 'N/A';
  const sortino = m ? m.sortino_4gw : 'N/A';
  const consistency = m ? m.consistency_4gw : 'N/A';
  const homeAvg = m ? m.home_avg_season : 'N/A';
  const awayAvg = m ? m.away_avg_season : 'N/A';
  const formDir = m ? m.form_direction : 'N/A';
  const xgShare = m ? (m.xg_share_4gw ? (m.xg_share_4gw * 100).toFixed(1) + '%' : 'N/A') : 'N/A';
  const xaShare = m ? (m.xa_share_4gw ? (m.xa_share_4gw * 100).toFixed(1) + '%' : 'N/A') : 'N/A';

  // Per90 stats
  const ptsPer90 = std ? std.pts_per90_season : 'N/A';
  const xgPer90 = std ? std.xg_per90_season : 'N/A';
  const xaPer90 = std ? std.xa_per90_season : 'N/A';
  const ptsDelta = std ? std.pts_delta : 'N/A';

  // Narrative verdict for the hero strip
  const bundle = buildPlayerBundle(r.element, data);
  const verdict = bundle ? buildPlayerVerdict(bundle, data) : null;
  const toneClass = { good: 't-good', warn: 't-warn', bad: 't-bad', info: 't-info' };
  const verdictHero = verdict && (verdict.score != null || verdict.bullets.length) ? `
      <div class="verdict-hero">
        ${verdict.score != null ? radialGauge(verdict.score, 100, verdict.scoreLabel, { tone: verdict.tone === 'info' ? 'brand' : verdict.tone }) : ''}
        <div class="verdict-info">
          <div class="verdict-kicker">The verdict</div>
          ${verdict.verdict ? `<div class="verdict-label">${verdict.verdict}</div>` : ''}
          ${personaHtml || flagHtml ? `<div class="personas-wrap">${personaHtml}${flagHtml}</div>` : ''}
          ${verdict.bullets.length ? `<ul class="bullet-list">
            ${verdict.bullets.map(b => `<li><span class="bullet-ic ${toneClass[b.tone] || 't-info'}">${icon(b.iconId, 14)}</span><span>${b.html}</span></li>`).join('')}
          </ul>` : ''}
          ${verdict.financeLine ? `<div class="verdict-finance">${verdict.financeLine}</div>` : ''}
        </div>
      </div>` : '';

  // Tier performance
  const tierData = data.tierPerf.filter(t => t.web_name === name);
  const tier1 = tierData.find(t => t.opponent_tier === 'Tier 1 - Top 6');
  const tier2 = tierData.find(t => t.opponent_tier === 'Tier 2 - Mid Upper');
  const tier3 = tierData.find(t => t.opponent_tier === 'Tier 3 - Rest');

  document.getElementById('player-result').innerHTML = `
    <div class="player-card">
      <div class="player-header">
        <div class="player-avatar">
          <img 
            loading="lazy" src="https://resources.premierleague.com/premierleague/photos/players/110x140/p${r.code}.png"
            alt="${name}"
            style="width:72px;height:90px;object-fit:cover;border-radius:8px;"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
          >
          <div class="t3" style="display:none;width:72px;height:90px;align-items:center;justify-content:center;">${positionIcon(pos, 30)}</div>
        </div>
        <div class="player-info">
          <div class="player-name">${name}</div>
          <div class="player-meta">
            <span class="badge badge-pos">${pos}</span>
            <span class="badge badge-team">
              ${teamBadgeUrl(r.team) ? `<img loading="lazy" src="${teamBadgeUrl(r.team)}" style="width:14px;height:14px;object-fit:contain;vertical-align:middle;margin-right:4px;" onerror="this.style.display='none'">` : ''}
              ${teamFullNames[r.team] || r.team}
            </span>
            <span class="badge badge-price">£${r.price}m</span>
            ${streakHtml}
          </div>
          <div class="player-ratings">
            <div class="rating-block">
              <div class="rating-label">
                <span class="tooltip-wrap">Season (Position)<span class="tooltip-icon">i</span><span class="tooltip-box">${TOOLTIPS.overall}</span></span>
              </div>
              <div class="rating-stars">${renderStars(r.season_overall_rating)}</div>
            </div>
            <div class="rating-block">
              <div class="rating-label">Last 4GW (Position)</div>
              <div class="rating-stars">${renderStars(r.gw4_overall_rating)}</div>
            </div>
            <div class="rating-block">
              <div class="rating-label">
                <span class="tooltip-wrap">Next 4GW (Fixtures)<span class="tooltip-icon">i</span><span class="tooltip-box">${TOOLTIPS.next4}</span></span>
              </div>
              <div class="rating-stars">${renderStars(r.next4_overall_rating)}</div>
            </div>
            ${isAtt ? `
            <div class="rating-block">
              <div class="rating-label">Season (Attacker)</div>
              <div class="rating-stars">${renderStars(r.season_att_overall_rating)}</div>
            </div>
            <div class="rating-block">
              <div class="rating-label">Last 4GW (Attacker)</div>
              <div class="rating-stars">${renderStars(r.gw4_att_overall_rating)}</div>
            </div>
            ` : ''}
          </div>
        </div>
      </div>

      ${verdictHero}

      <div class="tabs">
        <div class="tab active" onclick="showTab(this, 'overview-${name.replace(/\s/g,'-')}')">Overview</div>
        <div class="tab" onclick="showTab(this, 'ratings-${name.replace(/\s/g,'-')}')">Ratings</div>
        <div class="tab" onclick="showTab(this, 'stats-${name.replace(/\s/g,'-')}')">Stats & Metrics</div>
        <div class="tab" onclick="showTab(this, 'fixtures-${name.replace(/\s/g,'-')}')">Fixtures</div>
        ${pos !== 'GKP' ? `<div class="tab" onclick="showTab(this, 'shots-${name.replace(/\s/g,'-')}')">Shots</div>` : ''}
      </div>

      <!-- Overview Tab -->
      <div id="overview-${name.replace(/\s/g,'-')}" class="tab-content active">
        <div class="section-header">Key Stats (Season)</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="1dp">0</span>` : 'N/A')(r.season_ppg)}</div>
            <div class="stat-label">Pts Per Game</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="2dp">0</span>` : 'N/A')(ptsPer90 !== 'N/A' ? Number(ptsPer90) : null)}</div>
            <div class="stat-label">Pts Per 90</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="int">0</span>` : 'N/A')(r.total_mins)}</div>
            <div class="stat-label">Total Mins</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="int" data-count-suffix="%">0</span>` : 'N/A')(r.season_start_rate ? r.season_start_rate * 100 : null)}</div>
            <div class="stat-label">Start Rate</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="int" data-count-suffix="%">0</span>` : 'N/A')(r.season_mins90_rate ? r.season_mins90_rate * 100 : null)}</div>
            <div class="stat-label">90 Mins Rate</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${ptsDelta !== 'N/A' ? (ptsDelta > 0 ? '+' : '') + Number(ptsDelta).toFixed(2) : 'N/A'}</div>
            <div class="stat-label">Form Delta</div>
          </div>
        </div>

        ${isAtt ? `
        <div class="section-header">Attacking Share (Last 4GW)</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${xgShare}</div>
            <div class="stat-label">Team xG Share</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${xaShare}</div>
            <div class="stat-label">Team xA Share</div>
          </div>
        </div>
        ` : ''}
      </div>

      <!-- Ratings Tab -->
      <div id="ratings-${name.replace(/\s/g,'-')}" class="tab-content">
        <div class="section-header">Position Ratings — vs ${pos} players only</div>
        <table class="ratings-table">
          <thead><tr><th>Dimension</th><th>Season</th><th>Last 4GW</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Overall</strong></td>
              <td>${renderStars(r.season_overall_rating)}</td>
              <td>${renderStars(r.gw4_overall_rating)}</td>
            </tr>
            ${dimRows}
          </tbody>
        </table>

        ${isAtt ? `
        <div class="section-header" style="margin-top: 24px;">Attacker Ratings — vs all MID & FWD players</div>
        <table class="ratings-table">
          <thead><tr><th>Dimension</th><th>Season</th><th>Last 4GW</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Overall</strong></td>
              <td>${renderStars(r.season_att_overall_rating)}</td>
              <td>${renderStars(r.gw4_att_overall_rating)}</td>
            </tr>
            ${attDimRows}
          </tbody>
        </table>
        ` : ''}
      </div>

      <!-- Stats Tab -->
      <div id="stats-${name.replace(/\s/g,'-')}" class="tab-content">
        <div class="section-header">Per 90 Stats (Season)</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="2dp">0</span>` : 'N/A')(xgPer90 !== 'N/A' ? Number(xgPer90) : null)}</div>
            <div class="stat-label">xG per 90</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="2dp">0</span>` : 'N/A')(xaPer90 !== 'N/A' ? Number(xaPer90) : null)}</div>
            <div class="stat-label">xA per 90</div>
          </div>
        </div>

        <div class="section-header">Finance Metrics (Last 4GW)</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="2dp">0</span>` : 'N/A')(alpha !== 'N/A' ? Number(alpha) : null)}</div>
            <div class="stat-label">
              <span class="tooltip-wrap">Alpha<span class="tooltip-icon">i</span><span class="tooltip-box">${TOOLTIPS.alpha}</span></span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="2dp">0</span>` : 'N/A')(sharpe !== 'N/A' ? Number(sharpe) : null)}</div>
            <div class="stat-label">
              <span class="tooltip-wrap">Sharpe<span class="tooltip-icon">i</span><span class="tooltip-box">${TOOLTIPS.sharpe}</span></span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="2dp">0</span>` : 'N/A')(sortino !== 'N/A' ? Number(sortino) : null)}</div>
            <div class="stat-label">
              <span class="tooltip-wrap">Sortino<span class="tooltip-icon">i</span><span class="tooltip-box">${TOOLTIPS.sortino}</span></span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="2dp">0</span>` : 'N/A')(consistency !== 'N/A' ? Number(consistency) : null)}</div>
            <div class="stat-label">
              <span class="tooltip-wrap">Consistency<span class="tooltip-icon">i</span><span class="tooltip-box">${TOOLTIPS.consistency}</span></span>
            </div>
          </div>
        </div>

        <div class="section-header">Home vs Away (Season)</div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="1dp">0</span>` : 'N/A')(homeAvg !== 'N/A' ? Number(homeAvg) : null)}</div>
            <div class="stat-label">Home Avg Pts</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(v => v != null && !isNaN(v) ? `<span data-count="${v}" data-count-format="1dp">0</span>` : 'N/A')(awayAvg !== 'N/A' ? Number(awayAvg) : null)}</div>
            <div class="stat-label">Away Avg Pts</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${formDir}</div>
            <div class="stat-label">Form Direction</div>
          </div>
        </div>
      </div>

      <!-- Fixtures Tab -->
      <div id="fixtures-${name.replace(/\s/g,'-')}" class="tab-content">
        <div class="section-header">Performance by Opponent Tier</div>
        <table class="ratings-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Games</th>
              <th>Avg Pts</th>
              <th>Goals</th>
              <th>Assists</th>
              <th>Avg Bonus</th>
            </tr>
          </thead>
          <tbody>
            ${buildTierRow('Tier 1 — Top 6', tier1)}
            ${buildTierRow('Tier 2 — Mid Upper', tier2)}
            ${buildTierRow('Tier 3 — Rest', tier3)}
          </tbody>
        </table>
      </div>

      ${pos !== 'GKP' ? `
      <div id="shots-${name.replace(/\s/g,'-')}" class="tab-content">
        <div class="section-header">Shot Map</div>
        <div id="pshotmap-${r.element}"></div>
        <div class="section-header" style="margin-top:20px">Shot Zones</div>
        <div id="pzonemap-${r.element}"></div>
      </div>
      ` : ''}
    </div>
  `;

  if (pos !== 'GKP') {
    renderPlayerShotMap(r.element, document.getElementById(`pshotmap-${r.element}`));
    renderPlayerZoneMap(r.element, name, document.getElementById(`pzonemap-${r.element}`));
  }
  animateCounters(document.getElementById('player-result'));
  revealBars(document.getElementById('player-result'));
}

function buildDimRows(dims, r) {
  return dims.map(([label, sCol, gCol, tipKey]) => {
    const tooltip = tipKey && TOOLTIPS[tipKey] ? tip(TOOLTIPS[tipKey]) : '';
    return `<tr><td><span class="tooltip-wrap">${label}${tooltip ? `<span class="tooltip-icon">i</span><span class="tooltip-box">${TOOLTIPS[tipKey]}</span>` : ''}</span></td><td>${renderStars(r[sCol])}</td><td>${renderStars(r[gCol])}</td></tr>`;
  }).join('');
}

function buildTierRow(label, tier) {
  if (!tier) return `<tr><td>${label}</td><td colspan="5" class="t2">No data</td></tr>`;
  return `<tr>
    <td>${label}</td>
    <td>${tier.games_played}</td>
    <td class="num t-brand">${Number(tier.avg_pts).toFixed(1)}</td>
    <td>${tier.total_goals}</td>
    <td>${tier.total_assists}</td>
    <td>${Number(tier.avg_bonus).toFixed(1)}</td>
  </tr>`;
}

function showPlayerFromRankings(name) {
  showPage('player');
  showPlayer(name);
  window.scrollTo(0, 0);
}

window.showPlayer = showPlayer;
window.showPlayerFromRankings = showPlayerFromRankings;
export { renderPlayersDefault, initSearch, showPlayer, showPlayerFromRankings };
