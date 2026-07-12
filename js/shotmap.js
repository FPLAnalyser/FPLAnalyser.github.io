// shotmap.js — per-team "shots conceded" zone map, from Understat shot data.
// Every shot is already in the conceding team's own defensive frame: Understat
// normalises both X and Y to the shooting side's attacking direction, so shots
// against a team land in the same visual channel (same "left"/"right" of the
// rendered pitch) whether the match was home or away, or which half it was.
// "Left"/"Right" below means left/right as drawn in this diagram — the
// standard convention for shot-map graphics — not a claim about either team's
// own tactical flank.
import { loadTable } from './data.js';
import { teamFullNames } from './util.js';

let shotsPromise = null;
function loadShotsConceded() {
  if (!shotsPromise) shotsPromise = loadTable('shots_conceded', null).catch(() => ({}));
  return shotsPromise;
}

// Box geometry in meters on the 68 x 52.5 half-pitch viewBox (goal at y=0).
const BOX = { left: 13.84, right: 54.16, depth: 16.5 };
const THIRD = (BOX.right - BOX.left) / 3; // 13.44
const ZONE_LABEL = { left: 'Left of Box', middle: 'Middle of Box', right: 'Right of Box', outside: 'Outside Box' };
const NARRATIVE_LABEL = { left: 'left side of the box', middle: 'middle of the box', right: 'right side of the box', outside: 'outside the box' };

// Understat X in [0.5, 1] of full pitch length -> meters from the goal line;
// Understat Y in [0, 1] of pitch width -> meters across (0 = left edge drawn).
function toPitch(x, y) {
  const clampedX = Math.max(0.5, Math.min(1, Number(x)));
  const clampedY = Math.max(0, Math.min(1, Number(y)));
  return { cx: clampedY * 68, cy: (1 - clampedX) * 105 };
}

function classifyZone(x, y) {
  const { cx, cy } = toPitch(x, y);
  if (cy <= BOX.depth && cx >= BOX.left && cx <= BOX.right) {
    if (cx < BOX.left + THIRD) return 'left';
    if (cx < BOX.left + 2 * THIRD) return 'middle';
    return 'right';
  }
  return 'outside';
}

function emptyAgg() { return { shots: 0, goals: 0, xg: 0, corners: 0, openPlay: 0 }; }

function aggregateZones(shots) {
  const zones = { left: emptyAgg(), middle: emptyAgg(), right: emptyAgg(), outside: emptyAgg() };
  for (const s of shots) {
    const z = zones[classifyZone(s.x, s.y)];
    z.shots++;
    if (s.result === 'Goal') z.goals++;
    z.xg += Number(s.xg) || 0;
    if (s.situation === 'FromCorner') z.corners++;
    else if (s.situation === 'OpenPlay') z.openPlay++;
  }
  return zones;
}

// "Last N gameweeks" for a team ~= their last N match dates — the site's
// rolling windows elsewhere use real GW numbers, but one team plays exactly
// one match per GW, so distinct recent kickoff dates is an equivalent, and
// this needs no fixture-id join to build.
function windowShots(shots, window) {
  if (window === 'season') return shots;
  const n = window === '4gw' ? 4 : 6;
  const dates = [...new Set(shots.map(s => s.kickoff_date))].sort().reverse().slice(0, n);
  const keep = new Set(dates);
  return shots.filter(s => keep.has(s.kickoff_date));
}

function venueFilterShots(shots, venue) {
  return venue === 'all' ? shots : shots.filter(s => s.venue === venue);
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

function buildNarrative(zones, team) {
  const teamName = teamFullNames[team] || team;
  const totalShots = Object.values(zones).reduce((a, z) => a + z.shots, 0);
  if (!totalShots) return [];
  const totalXg = Object.values(zones).reduce((a, z) => a + z.xg, 0);
  const totalGoals = Object.values(zones).reduce((a, z) => a + z.goals, 0);
  const totalCorners = Object.values(zones).reduce((a, z) => a + z.corners, 0);
  const entries = Object.entries(zones);

  const lines = [];
  const [topXgZone, topXgAgg] = entries.slice().sort((a, b) => b[1].xg - a[1].xg)[0];
  if (topXgAgg.xg > 0) {
    const pct = Math.round(topXgAgg.xg / totalXg * 100);
    lines.push(`${teamName} concede the most xG from the ${NARRATIVE_LABEL[topXgZone]} — ${topXgAgg.xg.toFixed(1)} xG (${pct}% of the total).`);
  }

  const [topGoalZone, topGoalAgg] = entries.slice().sort((a, b) => b[1].goals - a[1].goals)[0];
  if (topGoalAgg.goals > 0 && topGoalZone !== topXgZone) {
    lines.push(`Most goals conceded have come from the ${NARRATIVE_LABEL[topGoalZone]} (${topGoalAgg.goals} of ${totalGoals}).`);
  }

  if (totalCorners > 0) {
    const pct = Math.round(totalCorners / totalShots * 100);
    lines.push(`${totalCorners} of ${totalShots} shots faced (${pct}%) have come from corners.`);
  }

  return lines;
}

function narrativeBlock(zones, team) {
  const lines = buildNarrative(zones, team);
  if (!lines.length) return '';
  return `<ul class="shotmap-narrative">${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
}

function zonePaths() {
  const { left, right, depth } = BOX;
  return {
    left: { d: `M ${left} 0 H ${left + THIRD} V ${depth} H ${left} Z`, cx: left + THIRD / 2, cy: depth / 2 },
    middle: { d: `M ${left + THIRD} 0 H ${left + 2 * THIRD} V ${depth} H ${left + THIRD} Z`, cx: left + 1.5 * THIRD, cy: depth / 2 },
    right: { d: `M ${left + 2 * THIRD} 0 H ${right} V ${depth} H ${left + 2 * THIRD} Z`, cx: left + 2.5 * THIRD, cy: depth / 2 },
    outside: { d: `M 0 0 H 68 V 52.5 H 0 Z M ${left} 0 H ${right} V ${depth} H ${left} Z`, cx: 34, cy: 32, evenodd: true },
  };
}

function pitchMarkings() {
  return `
    <line class="shotmap-line" x1="0" y1="52.5" x2="68" y2="52.5"></line>
    <path class="shotmap-line" d="M 24.85 52.5 A 9.15 9.15 0 0 1 43.15 52.5"></path>
    <rect class="shotmap-line" x="13.84" y="0" width="40.32" height="16.5"></rect>
    <rect class="shotmap-line" x="24.84" y="0" width="18.32" height="5.5"></rect>
    <rect class="shotmap-line" x="30.34" y="-2" width="7.32" height="2"></rect>
    <circle class="shotmap-spot" cx="34" cy="11" r="0.35"></circle>
    <path class="shotmap-line" d="M 26.7 16.5 A 9.15 9.15 0 0 0 41.3 16.5"></path>
  `;
}

function zoneShapes(zones) {
  const paths = zonePaths();
  const maxXg = Math.max(...Object.values(zones).map(z => z.xg), 0.0001);
  return Object.entries(paths).map(([key, p]) => {
    const agg = zones[key];
    const share = agg.xg / maxXg;
    const opacity = (0.12 + share * 0.55).toFixed(2);
    return `<path class="shotmap-zone" data-zone="${key}" d="${p.d}"
      ${p.evenodd ? 'fill-rule="evenodd"' : ''} style="fill:var(--accent);fill-opacity:${opacity}"></path>`;
  }).join('');
}

function zoneLabels(zones) {
  const paths = zonePaths();
  return Object.entries(paths).map(([key, p]) => {
    const agg = zones[key];
    const left = (p.cx / 68 * 100).toFixed(1);
    const top = (p.cy / 52.5 * 100).toFixed(1);
    return `
      <div class="shotmap-zone-label" data-zone="${key}" style="left:${left}%;top:${top}%">
        <div class="shotmap-zone-name">${ZONE_LABEL[key]}</div>
        <div class="shotmap-zone-xg">${agg.xg.toFixed(1)} <span>xG</span></div>
        <div class="shotmap-zone-sub">${agg.shots} shots${agg.goals ? ` · <span class="shotmap-zone-goals">${agg.goals} goal${agg.goals === 1 ? '' : 's'}</span>` : ''}</div>
      </div>`;
  }).join('');
}

function controlsRow() {
  return `
    <div class="shotmap-controls">
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

function tooltipText(key, agg) {
  const other = agg.shots - agg.corners - agg.openPlay;
  const parts = [`${agg.shots} shots · ${agg.xg.toFixed(2)} xG · ${agg.goals} goal${agg.goals === 1 ? '' : 's'}`,
    `Open play ${agg.openPlay} · Corners ${agg.corners}${other > 0 ? ` · Other ${other}` : ''}`];
  return { title: ZONE_LABEL[key], lines: parts };
}

function currentSlice(root) {
  const windowed = windowShots(root._allShots, root._window);
  return venueFilterShots(windowed, root._venue);
}

function rerender(root, team) {
  const shots = currentSlice(root);
  const zones = aggregateZones(shots);
  root.querySelector('.shotmap-summary').outerHTML = `<div class="shotmap-summary">${summaryRow(shots)}</div>`;
  root.querySelector('.shotmap-narrative-wrap').innerHTML = narrativeBlock(zones, team);
  root.querySelector('.shotmap-zones').innerHTML = zoneShapes(zones);
  root.querySelector('.shotmap-zone-labels').innerHTML = zoneLabels(zones);
  root._zones = zones;
  root.querySelector('.shotmap-tooltip').style.display = 'none';
}

function bindHover(root) {
  const wrap = root.querySelector('.shotmap-wrap');
  const tooltip = root.querySelector('.shotmap-tooltip');

  wrap.addEventListener('pointermove', e => {
    const target = e.target.closest('[data-zone]');
    if (!target) { tooltip.style.display = 'none'; return; }
    const key = target.dataset.zone;
    const agg = root._zones[key];
    const { title, lines } = tooltipText(key, agg);
    tooltip.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'shotmap-tooltip-title';
    t.textContent = title;
    tooltip.appendChild(t);
    lines.forEach(line => {
      const d = document.createElement('div');
      d.className = 'shotmap-tooltip-meta';
      d.textContent = line;
      tooltip.appendChild(d);
    });
    tooltip.style.display = 'block';
    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = Math.min(e.clientX - wrapRect.left + 12, wrapRect.width - 220) + 'px';
    tooltip.style.top = Math.max(e.clientY - wrapRect.top - 50, 0) + 'px';
  });
  wrap.addEventListener('pointerleave', () => { tooltip.style.display = 'none'; });
}

function bindControls(root, team) {
  root.querySelectorAll('.shotmap-filters').forEach(group => {
    group.querySelectorAll('.shotmap-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.shotmap-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (btn.dataset.window) root._window = btn.dataset.window;
        if (btn.dataset.venue) root._venue = btn.dataset.venue;
        rerender(root, team);
      });
    });
  });
}

async function renderShotMap(team, container) {
  container.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px 0">Loading shot data…</div>';
  const all = await loadShotsConceded();
  const shots = all[team] || [];

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
      <svg class="shotmap-pitch" viewBox="0 0 68 52.5" preserveAspectRatio="xMidYMid meet">
        <g class="shotmap-zones"></g>
        ${pitchMarkings()}
      </svg>
      <div class="shotmap-zone-labels"></div>
      <div class="shotmap-tooltip" style="display:none"></div>
    </div>
    <div class="shotmap-legend-note">Shading = share of xG conceded by zone</div>
  `;
  container._allShots = shots;
  container._window = 'season';
  container._venue = 'all';
  rerender(container, team);
  bindHover(container);
  bindControls(container, team);
}

export { renderShotMap };
