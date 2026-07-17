// playershotmap.js — per-player shot map (Understat data).
//
// A scatter of a player's own shots on a half-pitch: position = where they
// shot from, size = xG, fill = goal vs not, colour = recency. Shots from the
// last 4 gameweeks are highlighted so recent shooting stands out from the
// season backdrop. All figures are non-penalty (penalties would just stack on
// the spot and distort the xG), matching the team shot maps.
import { loadTable } from './data.js';
import { teamFullNames } from './util.js';

let shotsPromise = null;
function loadPlayerShots() {
  if (!shotsPromise) shotsPromise = loadTable('player_shots', null).catch(() => ({}));
  return shotsPromise;
}

const YD_PER_M = 1.09361;
const VIEW = { yMin: -5, w: 68, h: 57.5 };
const RECENT_GWS = 4;

const RESULT_LABEL = {
  Goal: 'Goal', SavedShot: 'Saved', BlockedShot: 'Blocked',
  MissedShots: 'Off target', ShotOnPost: 'Hit post', OwnGoal: 'Own goal',
};
const SITUATION_LABEL = {
  OpenPlay: 'Open play', FromCorner: 'From corner', SetPiece: 'Set piece',
  DirectFreekick: 'Free kick', Penalty: 'Penalty',
};

function distanceYards(x, y) {
  const depthM = (1 - Number(x)) * 105;
  const widthM = (Number(y) - 0.5) * 68;
  return Math.sqrt(depthM * depthM + widthM * widthM) * YD_PER_M;
}

// Y=0 draws on the pitch's right, Y=1 on the left — matches the team shot
// map's convention (js/shotmap.js), confirmed against real shot locations.
function toPitch(x, y) {
  const cy = (1 - Math.max(0.5, Math.min(1, Number(x)))) * 105;
  const cx = (1 - Math.max(0, Math.min(1, Number(y)))) * 68;
  return { cx, cy };
}

// Area-proportional radius (viewBox metres). Min keeps a 0-xG shot visible.
function radiusFor(xg) {
  return Math.min(3.4, 0.7 + Math.sqrt(Math.max(0, Number(xg) || 0)) * 3.0);
}

function recentDateSet(shots) {
  const dates = [...new Set(shots.map(s => s.kickoff_date))].sort().reverse().slice(0, RECENT_GWS);
  return new Set(dates);
}

function pitchAndGoal() {
  const gl = 30.34, gr = 37.66, gt = -3.6;
  const netCols = [1, 2, 3, 4, 5, 6].map(i => gl + (gr - gl) * i / 7);
  const netRows = [-1.2, -2.4];
  return `
    <rect class="shotmap-line" x="0" y="0" width="68" height="52.5"></rect>
    <path class="shotmap-line" d="M 24.85 52.5 A 9.15 9.15 0 0 1 43.15 52.5"></path>
    <rect class="shotmap-line shotmap-box" x="13.84" y="0" width="40.32" height="16.5"></rect>
    <rect class="shotmap-line shotmap-box" x="24.84" y="0" width="18.32" height="5.5"></rect>
    <circle class="shotmap-spot" cx="34" cy="11" r="0.35"></circle>
    <path class="shotmap-line" d="M 26.7 16.5 A 9.15 9.15 0 0 0 41.3 16.5"></path>
    <g class="shotmap-goal">
      ${netCols.map(x => `<line class="shotmap-net" x1="${x.toFixed(2)}" y1="0" x2="${x.toFixed(2)}" y2="${gt}"></line>`).join('')}
      ${netRows.map(y => `<line class="shotmap-net" x1="${gl}" y1="${y}" x2="${gr}" y2="${y}"></line>`).join('')}
      <path class="shotmap-goal-frame" d="M ${gl} 0 L ${gl} ${gt} L ${gr} ${gt} L ${gr} 0"></path>
    </g>
  `;
}

function summaryRow(shots) {
  const n = shots.length;
  const goals = shots.filter(s => s.result === 'Goal').length;
  const xg = shots.reduce((a, s) => a + (Number(s.xg) || 0), 0);
  const onTarget = shots.filter(s => s.result === 'Goal' || s.result === 'SavedShot').length;
  const avgDist = n ? shots.reduce((a, s) => a + distanceYards(s.x, s.y), 0) / n : 0;
  return `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${n}</div><div class="stat-label">NP Shots</div></div>
      <div class="stat-card"><div class="stat-value">${goals}</div><div class="stat-label">NP Goals</div></div>
      <div class="stat-card"><div class="stat-value">${xg.toFixed(1)}</div><div class="stat-label">NPxG</div></div>
      <div class="stat-card"><div class="stat-value">${n ? (xg / n).toFixed(2) : '0.00'}</div><div class="stat-label">xG / Shot</div></div>
      <div class="stat-card"><div class="stat-value">${avgDist.toFixed(1)}<span style="font-size:12px"> yd</span></div><div class="stat-label">Avg. Distance</div></div>
    </div>
  `;
}

// Older shots first so the highlighted recent shots paint on top.
function shotDots(shots, recent) {
  const ordered = shots
    .map((s, i) => ({ s, i, recent: recent.has(s.kickoff_date) }))
    .sort((a, b) => (a.recent ? 1 : 0) - (b.recent ? 1 : 0));
  return ordered.map(({ s, i, recent: isRecent }) => {
    const { cx, cy } = toPitch(s.x, s.y);
    const r = radiusFor(s.xg);
    const cls = [
      'pshot-dot',
      isRecent ? 'pshot-recent' : 'pshot-old',
      s.result === 'Goal' ? 'pshot-goal' : '',
    ].filter(Boolean).join(' ');
    return `<circle class="${cls}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}"></circle>
      <circle class="pshot-hit" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(Math.max(r, 1.8) + 0.8).toFixed(2)}" data-idx="${i}"></circle>`;
  }).join('');
}

// Each swatch is an exact match for one of the four dot styles actually
// drawn on the pitch (recency x outcome) — no abstract/generic swatch that
// could be confused with another (a plain grey-filled circle meant "earlier"
// in one swatch and "goal" in another swatch previously, and the two were
// indistinguishable).
function legend() {
  return `
    <div class="pshot-legend">
      <span class="pshot-key"><span class="pshot-swatch pshot-sw-recent-goal"></span>Last 4 GWs · Goal</span>
      <span class="pshot-key"><span class="pshot-swatch pshot-sw-recent-shot"></span>Last 4 GWs · Shot</span>
      <span class="pshot-key"><span class="pshot-swatch pshot-sw-old-goal"></span>Earlier · Goal</span>
      <span class="pshot-key"><span class="pshot-swatch pshot-sw-old-shot"></span>Earlier · Shot</span>
      <span class="pshot-key pshot-note">Size = xG</span>
    </div>
  `;
}

function bindHover(root) {
  const wrap = root.querySelector('.shotmap-pitch-col');
  const tooltip = root.querySelector('.shotmap-tooltip');
  wrap.addEventListener('pointermove', e => {
    const hit = e.target.closest('.pshot-hit');
    if (!hit) { tooltip.style.display = 'none'; return; }
    const s = root._shots[Number(hit.dataset.idx)];
    if (!s) return;
    const recent = root._recent.has(s.kickoff_date);
    tooltip.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'shotmap-tooltip-title';
    title.textContent = `${RESULT_LABEL[s.result] || s.result} · ${s.minute}'`;
    const l1 = document.createElement('div');
    l1.className = 'shotmap-tooltip-meta';
    l1.textContent = `${Number(s.xg).toFixed(2)} xG · ${SITUATION_LABEL[s.situation] || s.situation}`;
    const l2 = document.createElement('div');
    l2.className = 'shotmap-tooltip-meta';
    l2.textContent = `vs ${teamFullNames[s.opp] || s.opp || '—'} · ${s.kickoff_date}`;
    tooltip.append(title, l1, l2);
    if (recent) {
      const tag = document.createElement('div');
      tag.className = 'pshot-tt-recent';
      tag.textContent = 'Last 4 GWs';
      tooltip.appendChild(tag);
    }
    tooltip.style.display = 'block';
    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = Math.min(e.clientX - wrapRect.left + 12, wrapRect.width - 190) + 'px';
    tooltip.style.top = Math.max(e.clientY - wrapRect.top - 60, 0) + 'px';
  });
  wrap.addEventListener('pointerleave', () => { tooltip.style.display = 'none'; });
}

async function renderPlayerShotMap(element, container) {
  if (!container) return;
  container.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px 0">Loading shot data…</div>';
  const all = await loadPlayerShots();
  const raw = all[String(element)] || [];
  const shots = raw.filter(s => s.situation !== 'Penalty');

  if (!shots.length) {
    container.innerHTML = `<div style="color:var(--text2);font-size:13px;padding:12px 0">
      No non-penalty shots recorded for this player yet.</div>`;
    return;
  }

  const recent = recentDateSet(shots);
  container.innerHTML = `
    <div class="shotmap-summary">${summaryRow(shots)}</div>
    <div class="shotmap-wrap">
      <div class="shotmap-orientation">
        <svg class="shotmap-arrow-icon" viewBox="0 0 20 70" preserveAspectRatio="xMidYMid meet">
          <line x1="10" y1="68" x2="10" y2="14"></line>
          <path d="M 2 20 L 10 4 L 18 20 Z"></path>
        </svg>
        <span class="shotmap-orientation-label">Attack</span>
      </div>
      <div class="shotmap-pitch-col">
        <svg class="shotmap-pitch" viewBox="0 ${VIEW.yMin} ${VIEW.w} ${VIEW.h}" preserveAspectRatio="xMidYMid meet">
          ${pitchAndGoal()}
          <g class="pshot-layer">${shotDots(shots, recent)}</g>
        </svg>
        <div class="shotmap-tooltip" style="display:none"></div>
      </div>
    </div>
    ${legend()}
  `;
  container._shots = shots;
  container._recent = recent;
  bindHover(container);
}

export { renderPlayerShotMap, loadPlayerShots };
