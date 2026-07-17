// shotmap.js — per-team shot map (Understat data), attack and defence.
//
// Orientation: "Left"/"Right" mean the TEAM'S OWN left/right — the same side
// their own left-back would occupy — not the shooter's. For attack (a team's
// own shots) that's already how Understat's shot coordinates read once drawn
// left-to-right. For defence (shots faced), the shooting team is the
// opponent, facing the opposite way, so their left/right is a mirror image
// of the defending team's — the plotted x-position is flipped before
// classifying or drawing anything, so the rendered picture and every label
// agree with each other by construction.
//
// All figures exclude penalties (their near-certain xG/outcome would swamp
// the pattern of open-play shooting locations).
import { loadTable } from './data.js';
import { teamFullNames } from './util.js';
import {
  VIEW_Y_MIN, VIEW_H, VIEW_W, METRIC_META,
  toPitch, analyse, windowShots, venueFilterShots, narrativeBlock,
  pitchMarkings, goalFrame, cellOutlines, zoneFills, zoneLabels,
  orientationArrow, bindZoneHover,
} from './shotzones.js';

let forPromise = null, againstPromise = null;
function loadShots(mode) {
  if (mode === 'for') {
    if (!forPromise) forPromise = loadTable('shots_for', null).catch(() => ({}));
    return forPromise;
  }
  if (!againstPromise) againstPromise = loadTable('shots_conceded', null).catch(() => ({}));
  return againstPromise;
}

function summaryRow(a, mode) {
  const shotsPerGame = a.matches ? a.totalShots / a.matches : 0;
  const xgPerShot = a.totalShots ? a.totalXg / a.totalShots : 0;
  const onTargetPct = a.totalShots ? Math.round(a.totalOnTarget / a.totalShots * 100) : 0;
  const shotsLabel = mode === 'for' ? 'Shots / Game' : 'Shots Faced / Game';
  const goalsLabel = mode === 'for' ? 'Goals' : 'Goals Conceded';
  const distLabel = mode === 'for' ? 'Avg. Shot Distance' : 'Avg. Distance Conceded';
  return `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${shotsPerGame.toFixed(1)}</div><div class="stat-label">${shotsLabel}</div></div>
      <div class="stat-card"><div class="stat-value">${a.totalGoals}</div><div class="stat-label">${goalsLabel}</div></div>
      <div class="stat-card"><div class="stat-value">${xgPerShot.toFixed(2)}</div><div class="stat-label">xG / Shot</div></div>
      <div class="stat-card"><div class="stat-value">${a.avgDistance.toFixed(1)}<span style="font-size:12px"> yd</span></div><div class="stat-label">${distLabel}</div></div>
      <div class="stat-card"><div class="stat-value">${onTargetPct}%</div><div class="stat-label">On Target</div></div>
    </div>
  `;
}

function narrativeOpts(mode) {
  return mode === 'for'
    ? { verb: 'create', shotsNoun: 'shots taken', goalVerb: 'scored' }
    : { verb: 'concede', shotsNoun: 'shots faced', goalVerb: 'conceded' };
}

function scatterDots(shots, mode) {
  return shots
    .filter(s => s.situation !== 'Penalty')
    .map(s => {
      const { cx, cy } = toPitch(s.x, s.y, mode);
      return `<circle class="shotmap-scatter" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="0.55"></circle>`;
    }).join('');
}

function controlsRow() {
  return `
    <div class="shotmap-controls">
      <div class="shotmap-filters shotmap-mode" data-group="mode">
        <button class="shotmap-filter active" data-mode="against">Defence</button>
        <button class="shotmap-filter" data-mode="for">Attack</button>
      </div>
      <div class="shotmap-filters" data-group="metric">
        <button class="shotmap-filter active" data-metric="xg">xG</button>
        <button class="shotmap-filter" data-metric="goals">Goals</button>
        <button class="shotmap-filter" data-metric="shots">Shots</button>
      </div>
      <div class="shotmap-filters" data-group="window">
        <button class="shotmap-filter active" data-window="season">Season</button>
        <button class="shotmap-filter" data-window="4gw">Last 4</button>
        <button class="shotmap-filter" data-window="6gw">Last 6</button>
      </div>
      <div class="shotmap-filters" data-group="venue">
        <button class="shotmap-filter active" data-venue="all">All</button>
        <button class="shotmap-filter" data-venue="H">Home</button>
        <button class="shotmap-filter" data-venue="A">Away</button>
      </div>
    </div>
  `;
}

function currentSlice(root) {
  const windowed = windowShots(root._allShots[root._mode] || [], root._window);
  return venueFilterShots(windowed, root._venue);
}

function rerender(root, team) {
  const shots = currentSlice(root);
  const a = analyse(shots, root._mode);
  const mm = METRIC_META[root._metric];
  const teamName = teamFullNames[team] || team;
  root._analysis = a;
  root.querySelector('.shotmap-summary').outerHTML = `<div class="shotmap-summary">${summaryRow(a, root._mode)}</div>`;
  root.querySelector('.shotmap-narrative-wrap').innerHTML = narrativeBlock(a, teamName, root._metric, narrativeOpts(root._mode));
  root.querySelector('.shotmap-scatter-layer').innerHTML = scatterDots(shots, root._mode);
  root.querySelector('.shotmap-zones').innerHTML = zoneFills(a.zones, root._metric);
  root.querySelector('.shotmap-zone-labels').innerHTML = zoneLabels(a.zones, a[mm.totalKey], root._metric);
  root.querySelector('.shotmap-legend-note').textContent =
    `% = share of ${mm.noun} by zone · shading follows the same share`;
  root.querySelector('.shotmap-tooltip').style.display = 'none';
}

async function ensureMode(root, mode) {
  if (root._allShots[mode]) return;
  const all = await loadShots(mode);
  root._allShots[mode] = all[root._team] || [];
}

function bindControls(root, team) {
  root.querySelectorAll('.shotmap-filters').forEach(group => {
    group.querySelectorAll('.shotmap-filter').forEach(btn => {
      btn.addEventListener('click', async () => {
        group.querySelectorAll('.shotmap-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (btn.dataset.window) root._window = btn.dataset.window;
        if (btn.dataset.venue) root._venue = btn.dataset.venue;
        if (btn.dataset.metric) root._metric = btn.dataset.metric;
        if (btn.dataset.mode) {
          root._mode = btn.dataset.mode;
          await ensureMode(root, root._mode);
        }
        rerender(root, team);
      });
    });
  });
}

async function renderShotMap(team, container) {
  container.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px 0">Loading shot data…</div>';
  const against = await loadShots('against');
  const shots = against[team] || [];

  if (!shots.length) {
    container.innerHTML = `<div style="color:var(--text2);font-size:13px;padding:12px 0">
      No shot-level data yet for ${teamFullNames[team] || team} — run the Understat pull to populate this.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="shotmap-summary"></div>
    ${controlsRow()}
    <div class="shotmap-narrative-wrap"></div>
    <div class="shotmap-wrap">
      ${orientationArrow()}
      <div class="shotmap-pitch-col">
        <svg class="shotmap-pitch" viewBox="0 ${VIEW_Y_MIN} ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid meet">
          <g class="shotmap-scatter-layer"></g>
          <g class="shotmap-zones"></g>
          <g class="shotmap-outlines">${cellOutlines()}</g>
          ${pitchMarkings()}
          ${goalFrame()}
        </svg>
        <div class="shotmap-zone-labels"></div>
        <div class="shotmap-tooltip" style="display:none"></div>
      </div>
    </div>
    <div class="shotmap-legend-note"></div>
  `;
  container._team = team;
  container._allShots = { against: shots };
  container._mode = 'against';
  container._window = 'season';
  container._venue = 'all';
  container._metric = 'xg';
  rerender(container, team);
  bindZoneHover(container);
  bindControls(container, team);
}

export { renderShotMap };
