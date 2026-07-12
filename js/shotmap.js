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

let forPromise = null, againstPromise = null;
function loadShots(mode) {
  if (mode === 'for') {
    if (!forPromise) forPromise = loadTable('shots_for', null).catch(() => ({}));
    return forPromise;
  }
  if (!againstPromise) againstPromise = loadTable('shots_conceded', null).catch(() => ({}));
  return againstPromise;
}

const YD_PER_M = 1.09361;

// Box + grid geometry in meters on the 68 x 52.5 half-pitch viewBox (goal at y=0)
const BOX_L = 13.84, BOX_R = 54.16;
const THIRD = (BOX_R - BOX_L) / 3;
const T1 = BOX_L + THIRD, T2 = BOX_L + 2 * THIRD;
const DEPTH = { d0: 0, d1: 6, d2: 16.5, d3: 24, d4: 52.5 };

const ZONE_META = {
  'b1-l': { name: 'Left Six-Yard', narrative: 'the left of the six-yard box' },
  'b1-m': { name: 'Six-Yard Box', narrative: 'right in the six-yard box' },
  'b1-r': { name: 'Right Six-Yard', narrative: 'the right of the six-yard box' },
  'b2-wl': { name: 'Left Byline', narrative: 'the left byline' },
  'b2-l': { name: 'Left of Box', narrative: 'the left side of the box' },
  'b2-m': { name: 'Middle of Box', narrative: 'the middle of the box' },
  'b2-r': { name: 'Right of Box', narrative: 'the right side of the box' },
  'b2-wr': { name: 'Right Byline', narrative: 'the right byline' },
  'b3-wl': { name: 'Left Edge of Box', narrative: 'the left edge of the box' },
  'b3-c': { name: 'Edge of Box', narrative: 'the edge of the box' },
  'b3-wr': { name: 'Right Edge of Box', narrative: 'the right edge of the box' },
  'b4-wl': { name: 'Long Range, Left', narrative: 'long range on the left' },
  'b4-c': { name: 'Long Range, Central', narrative: 'long range, centrally' },
  'b4-wr': { name: 'Long Range, Right', narrative: 'long range on the right' },
};

const ZONE_SHAPES = {
  'b1-l': { x: BOX_L, y: DEPTH.d0, w: THIRD, h: DEPTH.d1 - DEPTH.d0 },
  'b1-m': { x: T1, y: DEPTH.d0, w: THIRD, h: DEPTH.d1 - DEPTH.d0 },
  'b1-r': { x: T2, y: DEPTH.d0, w: THIRD, h: DEPTH.d1 - DEPTH.d0 },
  'b2-wl': { x: 0, y: DEPTH.d1, w: BOX_L, h: DEPTH.d2 - DEPTH.d1 },
  'b2-l': { x: BOX_L, y: DEPTH.d1, w: THIRD, h: DEPTH.d2 - DEPTH.d1 },
  'b2-m': { x: T1, y: DEPTH.d1, w: THIRD, h: DEPTH.d2 - DEPTH.d1 },
  'b2-r': { x: T2, y: DEPTH.d1, w: THIRD, h: DEPTH.d2 - DEPTH.d1 },
  'b2-wr': { x: BOX_R, y: DEPTH.d1, w: 68 - BOX_R, h: DEPTH.d2 - DEPTH.d1 },
  'b3-wl': { x: 0, y: DEPTH.d2, w: BOX_L, h: DEPTH.d3 - DEPTH.d2 },
  'b3-c': { x: BOX_L, y: DEPTH.d2, w: BOX_R - BOX_L, h: DEPTH.d3 - DEPTH.d2 },
  'b3-wr': { x: BOX_R, y: DEPTH.d2, w: 68 - BOX_R, h: DEPTH.d3 - DEPTH.d2 },
  'b4-wl': { x: 0, y: DEPTH.d3, w: BOX_L, h: DEPTH.d4 - DEPTH.d3 },
  'b4-c': { x: BOX_L, y: DEPTH.d3, w: BOX_R - BOX_L, h: DEPTH.d4 - DEPTH.d3 },
  'b4-wr': { x: BOX_R, y: DEPTH.d3, w: 68 - BOX_R, h: DEPTH.d4 - DEPTH.d3 },
};

// x,y are Understat's raw (unclamped) fractions — used for true distance.
function distanceYards(x, y) {
  const depthM = (1 - Number(x)) * 105;
  const widthOffsetM = (Number(y) - 0.5) * 68;
  return Math.sqrt(depthM * depthM + widthOffsetM * widthOffsetM) * YD_PER_M;
}

// Plotting/zone position: X clamped to the attacking half, Y mirrored for
// "against" so the rendered picture is always in the analysed team's own frame.
function toPitch(x, y, mode) {
  const clampedX = Math.max(0.5, Math.min(1, Number(x)));
  const clampedY = Math.max(0, Math.min(1, Number(y)));
  let cx = clampedY * 68;
  if (mode === 'against') cx = 68 - cx;
  return { cx, cy: (1 - clampedX) * 105 };
}

function classifyZone(cx, cy) {
  const inBoxWidth = cx >= BOX_L && cx <= BOX_R;
  const wide = cx < BOX_L ? 'wl' : cx > BOX_R ? 'wr' : null;
  if (cy <= DEPTH.d1) {
    if (!inBoxWidth) return wide === 'wl' ? 'b1-l' : 'b1-r';
    return cx < T1 ? 'b1-l' : cx < T2 ? 'b1-m' : 'b1-r';
  }
  if (cy <= DEPTH.d2) {
    if (!inBoxWidth) return `b2-${wide}`;
    return cx < T1 ? 'b2-l' : cx < T2 ? 'b2-m' : 'b2-r';
  }
  if (cy <= DEPTH.d3) return `b3-${wide || 'c'}`;
  return `b4-${wide || 'c'}`;
}

function emptyAgg() {
  return { shots: 0, goals: 0, xg: 0, corners: 0, openPlay: 0, distSum: 0 };
}

function analyse(shots, mode) {
  const zones = {};
  Object.keys(ZONE_META).forEach(k => { zones[k] = emptyAgg(); });
  const dates = new Set();
  let totalShots = 0, totalGoals = 0, totalXg = 0, totalOnTarget = 0, totalDistSum = 0;

  for (const s of shots) {
    if (s.situation === 'Penalty') continue; // non-penalty only, throughout
    dates.add(s.kickoff_date);
    const { cx, cy } = toPitch(s.x, s.y, mode);
    const key = classifyZone(cx, cy);
    const z = zones[key];
    const xg = Number(s.xg) || 0;
    const dist = distanceYards(s.x, s.y);
    z.shots++; z.xg += xg; z.distSum += dist;
    totalShots++; totalXg += xg; totalDistSum += dist;
    if (s.result === 'Goal') { z.goals++; totalGoals++; }
    if (s.result === 'Goal' || s.result === 'SavedShot') totalOnTarget++;
    if (s.situation === 'FromCorner') z.corners++;
    else if (s.situation === 'OpenPlay') z.openPlay++;
  }

  return {
    zones, matches: dates.size, totalShots, totalGoals, totalXg, totalOnTarget,
    avgDistance: totalShots ? totalDistSum / totalShots : 0,
  };
}

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

function buildNarrative(a, team, mode) {
  if (!a.totalShots) return [];
  const teamName = teamFullNames[team] || team;
  const entries = Object.entries(a.zones).filter(([, z]) => z.shots > 0);
  if (!entries.length) return [];

  const verb = mode === 'for' ? 'create' : 'concede';
  const noun = mode === 'for' ? 'their shots' : 'shots faced';
  const lines = [];

  const [topXgKey, topXgAgg] = entries.slice().sort((x, y) => y[1].xg - x[1].xg)[0];
  if (topXgAgg.xg > 0) {
    const pct = Math.round(topXgAgg.xg / a.totalXg * 100);
    lines.push(`${teamName} ${verb} the most non-penalty xG from ${ZONE_META[topXgKey].narrative} — ${topXgAgg.xg.toFixed(1)} xG (${pct}% of the total).`);
  }

  const [topGoalKey, topGoalAgg] = entries.slice().sort((x, y) => y[1].goals - x[1].goals)[0];
  if (topGoalAgg.goals > 0 && topGoalKey !== topXgKey) {
    const verbGoal = mode === 'for' ? 'scored' : 'conceded';
    lines.push(`Most non-penalty goals ${verbGoal} have come from ${ZONE_META[topGoalKey].narrative} (${topGoalAgg.goals} of ${a.totalGoals}).`);
  }

  const totalCorners = entries.reduce((sum, [, z]) => sum + z.corners, 0);
  if (totalCorners > 0) {
    const pct = Math.round(totalCorners / a.totalShots * 100);
    lines.push(`${totalCorners} of ${a.totalShots} ${noun} (${pct}%) have come from corners.`);
  }

  return lines;
}

function narrativeBlock(a, team, mode) {
  const lines = buildNarrative(a, team, mode);
  if (!lines.length) return '';
  return `<ul class="shotmap-narrative">${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
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

function scatterDots(shots, mode) {
  return shots
    .filter(s => s.situation !== 'Penalty')
    .map(s => {
      const { cx, cy } = toPitch(s.x, s.y, mode);
      return `<circle class="shotmap-scatter" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="0.55"></circle>`;
    }).join('');
}

// Outlines are drawn on their own layer, ON TOP of the fills, so adjacent
// filled cells stay visually distinct instead of merging into one blob.
function cellOutlines() {
  return Object.values(ZONE_SHAPES)
    .map(s => `<rect class="shotmap-cell-outline" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"></rect>`)
    .join('');
}

function zoneFills(zones) {
  const maxXg = Math.max(...Object.values(zones).map(z => z.xg), 0.0001);
  return Object.entries(ZONE_SHAPES).map(([key, s]) => {
    const agg = zones[key];
    if (!agg || agg.shots === 0) return '';
    const share = agg.xg / maxXg;
    const opacity = (0.14 + share * 0.6).toFixed(2);
    return `<rect class="shotmap-zone" data-zone="${key}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" style="fill:var(--accent);fill-opacity:${opacity}"></rect>`;
  }).join('');
}

function zoneLabels(zones, totalXg) {
  return Object.entries(ZONE_SHAPES).map(([key, s]) => {
    const agg = zones[key];
    if (!agg || agg.shots === 0) return '';
    const pct = totalXg > 0 ? Math.round(agg.xg / totalXg * 100) : 0;
    const left = ((s.x + s.w / 2) / 68 * 100).toFixed(1);
    const top = ((s.y + s.h / 2) / 52.5 * 100).toFixed(1);
    return `<div class="shotmap-zone-label" data-zone="${key}" style="left:${left}%;top:${top}%">${pct}%</div>`;
  }).join('');
}

function controlsRow() {
  return `
    <div class="shotmap-controls">
      <div class="shotmap-filters shotmap-mode" data-group="mode">
        <button class="shotmap-filter active" data-mode="against">Defence</button>
        <button class="shotmap-filter" data-mode="for">Attack</button>
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

function tooltipText(key, agg) {
  const other = agg.shots - agg.corners - agg.openPlay;
  const avgDist = agg.shots ? agg.distSum / agg.shots : 0;
  return {
    title: ZONE_META[key].name,
    lines: [
      `${agg.shots} shots · ${agg.xg.toFixed(2)} xG · ${agg.goals} goal${agg.goals === 1 ? '' : 's'}`,
      `Avg. distance ${avgDist.toFixed(1)} yd`,
      `Open play ${agg.openPlay} · Corners ${agg.corners}${other > 0 ? ` · Other ${other}` : ''}`,
    ],
  };
}

function currentSlice(root) {
  const windowed = windowShots(root._allShots[root._mode] || [], root._window);
  return venueFilterShots(windowed, root._venue);
}

function rerender(root, team) {
  const shots = currentSlice(root);
  const a = analyse(shots, root._mode);
  root._analysis = a;
  root.querySelector('.shotmap-summary').outerHTML = `<div class="shotmap-summary">${summaryRow(a, root._mode)}</div>`;
  root.querySelector('.shotmap-narrative-wrap').innerHTML = narrativeBlock(a, team, root._mode);
  root.querySelector('.shotmap-scatter-layer').innerHTML = scatterDots(shots, root._mode);
  root.querySelector('.shotmap-zones').innerHTML = zoneFills(a.zones);
  root.querySelector('.shotmap-zone-labels').innerHTML = zoneLabels(a.zones, a.totalXg);
  root.querySelector('.shotmap-tooltip').style.display = 'none';
}

function bindHover(root) {
  const wrap = root.querySelector('.shotmap-wrap');
  const tooltip = root.querySelector('.shotmap-tooltip');

  wrap.addEventListener('pointermove', e => {
    const target = e.target.closest('[data-zone]');
    if (!target) { tooltip.style.display = 'none'; return; }
    const key = target.dataset.zone;
    const agg = root._analysis.zones[key];
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
    tooltip.style.top = Math.max(e.clientY - wrapRect.top - 60, 0) + 'px';
  });
  wrap.addEventListener('pointerleave', () => { tooltip.style.display = 'none'; });
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
      <svg class="shotmap-pitch" viewBox="0 0 68 52.5" preserveAspectRatio="xMidYMid meet">
        <g class="shotmap-scatter-layer"></g>
        <g class="shotmap-zones"></g>
        <g class="shotmap-outlines">${cellOutlines()}</g>
        ${pitchMarkings()}
      </svg>
      <div class="shotmap-zone-labels"></div>
      <div class="shotmap-tooltip" style="display:none"></div>
    </div>
    <div class="shotmap-legend-note">% = share of non-penalty xG by zone · shading follows the same share</div>
  `;
  container._team = team;
  container._allShots = { against: shots };
  container._mode = 'against';
  container._window = 'season';
  container._venue = 'all';
  rerender(container, team);
  bindHover(container);
  bindControls(container, team);
}

export { renderShotMap };
