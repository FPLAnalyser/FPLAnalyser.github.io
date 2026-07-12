// shotmap.js — per-team "shots conceded" pitch map, from Understat shot data.
// Every shot is already in the conceding team's own defensive frame: Understat's
// X is normalised to the shooting side's attacking direction, so home and away
// shots against a team land on the same half-pitch without any flipping.
import { loadTable } from './data.js';
import { teamFullNames } from './util.js';

let shotsPromise = null;
function loadShotsConceded() {
  if (!shotsPromise) shotsPromise = loadTable('shots_conceded', null).catch(() => ({}));
  return shotsPromise;
}

const RESULT_STYLE = {
  Goal:        { css: 'goal',    label: 'Goal' },
  SavedShot:   { css: 'saved',   label: 'Saved' },
  BlockedShot: { css: 'blocked', label: 'Blocked' },
  MissedShot:  { css: 'off',     label: 'Off Target' },
  ShotOnPost:  { css: 'off',     label: 'Off Target' },
};
function styleFor(result) {
  return RESULT_STYLE[result] || RESULT_STYLE.MissedShot;
}

// Area-proportional radius (viewBox units on a 68 x 52.5m half-pitch)
function radiusFor(xg) {
  const v = Math.max(0, Number(xg) || 0);
  return Math.min(3.2, 0.9 + Math.sqrt(v) * 3.2);
}

// Understat X in [0.5, 1] of full pitch length -> meters from the goal line.
// X below 0.5 (rare halfway-line strikes) clamps to the halfway line edge.
function toPitch(x, y) {
  const clampedX = Math.max(0.5, Math.min(1, Number(x)));
  const clampedY = Math.max(0, Math.min(1, Number(y)));
  return { cx: clampedY * 68, cy: (1 - clampedX) * 105 };
}

function pitchMarkings() {
  return `
    <rect class="shotmap-turf" x="0" y="0" width="68" height="52.5"></rect>
    <line class="shotmap-line" x1="0" y1="52.5" x2="68" y2="52.5"></line>
    <path class="shotmap-line" d="M 24.85 52.5 A 9.15 9.15 0 0 1 43.15 52.5"></path>
    <rect class="shotmap-line" x="13.84" y="0" width="40.32" height="16.5"></rect>
    <rect class="shotmap-line" x="24.84" y="0" width="18.32" height="5.5"></rect>
    <rect class="shotmap-line" x="30.34" y="-2" width="7.32" height="2"></rect>
    <circle class="shotmap-spot" cx="34" cy="11" r="0.35"></circle>
    <path class="shotmap-line" d="M 26.7 16.5 A 9.15 9.15 0 0 0 41.3 16.5"></path>
  `;
}

function summaryRow(shots) {
  const n = shots.length;
  const goals = shots.filter(s => s.result === 'Goal').length;
  const xg = shots.reduce((a, s) => a + (Number(s.xg) || 0), 0);
  const onTarget = shots.filter(s => s.result === 'Goal' || s.result === 'SavedShot').length;
  return `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${n}</div><div class="stat-label">Shots Faced</div></div>
      <div class="stat-card"><div class="stat-value">${goals}</div><div class="stat-label">Goals Conceded</div></div>
      <div class="stat-card"><div class="stat-value">${xg.toFixed(1)}</div><div class="stat-label">xG Conceded</div></div>
      <div class="stat-card"><div class="stat-value">${n ? Math.round(onTarget / n * 100) : 0}%</div><div class="stat-label">Shots on Target</div></div>
    </div>
  `;
}

function legend() {
  return `
    <div class="shotmap-legend">
      <span class="shotmap-legend-item"><span class="shotmap-swatch goal"></span>Goal</span>
      <span class="shotmap-legend-item"><span class="shotmap-swatch saved"></span>Saved</span>
      <span class="shotmap-legend-item"><span class="shotmap-swatch blocked"></span>Blocked</span>
      <span class="shotmap-legend-item"><span class="shotmap-swatch off"></span>Off Target</span>
      <span class="shotmap-legend-note">Marker size = xG</span>
    </div>
  `;
}

function filterRow(team) {
  return `
    <div class="shotmap-filters" data-team="${team}">
      <button class="shotmap-filter active" data-venue="all">All</button>
      <button class="shotmap-filter" data-venue="H">Home</button>
      <button class="shotmap-filter" data-venue="A">Away</button>
    </div>
  `;
}

function renderDots(shots) {
  return shots.map((s, i) => {
    const { cx, cy } = toPitch(s.x, s.y);
    const r = radiusFor(s.xg);
    const st = styleFor(s.result);
    return `<circle class="shotmap-dot ${st.css}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" data-idx="${i}"></circle>
      <circle class="shotmap-hit" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${Math.max(r, 1.6) + 1.6}" data-idx="${i}"></circle>`;
  }).join('');
}

// Hover is wired once per pitch; it always reads root._shots, so it stays
// correct across filter changes without rebinding (and without piling up
// duplicate listeners on the persistent <svg> element).
function bindHover(root) {
  const svg = root.querySelector('.shotmap-pitch');
  const tooltip = root.querySelector('.shotmap-tooltip');
  const wrap = root.querySelector('.shotmap-wrap');

  svg.addEventListener('pointermove', e => {
    const hit = e.target.closest('.shotmap-hit');
    if (!hit) { tooltip.style.display = 'none'; return; }
    const s = root._shots[Number(hit.dataset.idx)];
    if (!s) return;
    const st = styleFor(s.result);
    tooltip.innerHTML = '';
    const line1 = document.createElement('div');
    line1.className = 'shotmap-tooltip-title';
    line1.textContent = `${st.label} · ${s.minute}'`;
    const line2 = document.createElement('div');
    line2.textContent = `${s.player} (${s.team})`;
    const line3 = document.createElement('div');
    line3.className = 'shotmap-tooltip-meta';
    line3.textContent = `xG ${Number(s.xg).toFixed(2)} · ${s.situation || 'Open Play'}`;
    tooltip.append(line1, line2, line3);
    tooltip.style.display = 'block';
    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = Math.min(e.clientX - wrapRect.left + 12, wrapRect.width - 170) + 'px';
    tooltip.style.top = Math.max(e.clientY - wrapRect.top - 60, 0) + 'px';
  });
  svg.addEventListener('pointerleave', () => { tooltip.style.display = 'none'; });
}

function bindFilters(root) {
  root.querySelectorAll('.shotmap-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.shotmap-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const venue = btn.dataset.venue;
      const filtered = venue === 'all' ? root._allShots : root._allShots.filter(s => s.venue === venue);
      root._shots = filtered;
      root.querySelector('.shotmap-dots').outerHTML = `<g class="shotmap-dots">${renderDots(filtered)}</g>`;
      root.querySelector('.shotmap-summary').outerHTML =
        `<div class="shotmap-summary">${summaryRow(filtered)}</div>`;
      root.querySelector('.shotmap-tooltip').style.display = 'none';
    });
  });
}

async function renderShotMap(team, container) {
  container.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px 0">Loading shot data…</div>';
  const all = await loadShotsConceded();
  const shots = (all[team] || []).slice().sort((a, b) => a.minute - b.minute);

  if (!shots.length) {
    container.innerHTML = `<div style="color:var(--text2);font-size:13px;padding:12px 0">
      No shot-level data yet for ${teamFullNames[team] || team} — run the Understat pull to populate this.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="shotmap-summary">${summaryRow(shots)}</div>
    ${filterRow(team)}
    <div class="shotmap-wrap">
      <svg class="shotmap-pitch" viewBox="0 0 68 52.5" preserveAspectRatio="xMidYMid meet">
        ${pitchMarkings()}
        <g class="shotmap-dots">${renderDots(shots)}</g>
      </svg>
      <div class="shotmap-tooltip" style="display:none"></div>
    </div>
    ${legend()}
  `;
  container._allShots = shots;
  container._shots = shots;
  bindHover(container);
  bindFilters(container);
}

export { renderShotMap };
