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

// Box + grid geometry in meters on the 68 x 52.5 half-pitch (goal at y=0).
// viewBox extends above y=0 (VIEW_Y_MIN) so the goal frame isn't clipped.
const BOX_L = 13.84, BOX_R = 54.16;
const BOX_THIRD = (BOX_R - BOX_L) / 3;
const BOX_T1 = BOX_L + BOX_THIRD, BOX_T2 = BOX_L + 2 * BOX_THIRD;
const SIX_YARD_L = 24.84, SIX_YARD_R = 43.16; // six-yard box: 18.32m wide, centred
const SIX_THIRD = (SIX_YARD_R - SIX_YARD_L) / 3;
const SIX_T1 = SIX_YARD_L + SIX_THIRD, SIX_T2 = SIX_YARD_L + 2 * SIX_THIRD;
// d1b splits the six-yard-width strip into three EQUAL 5.5m bands (0-5.5,
// 5.5-11, 11-16.5) — 11m also happens to be the real penalty-spot distance.
// d3 caps the "long range" band at 13.5m beyond the box (30m from goal) —
// past that, shots are rare enough that one big zone reads better than
// three thin ones.
const DEPTH = { d0: 0, d1: 5.5, d1b: 11, d2: 16.5, d3: 30, d4: 52.5 };
const VIEW_Y_MIN = -5, VIEW_H = DEPTH.d4 - VIEW_Y_MIN, VIEW_W = 68;

// 17 zones, matching Opta-style end-location grids. Byline + channel columns
// run the entire box depth (goal line to the 18-yard line) in one cell each
// side — only the six-yard-width middle strip gets finer depth resolution,
// split into three bands: the six-yard row (b1), the rest of the box
// (b2-l/m/r), and the back of the box right before the 18-yard line (b3-c,
// a single cell — precise left/right position matters less that deep).
// Long range (b4) runs from the box edge to 30m, split into three columns
// aligned to the box's own thirds (b4-l/m/r) flanked by the wide,
// outside-the-box-width columns (b4-wl/wr). Beyond 30m, all the way to the
// halfway line, is one single zone (b5) — too far out to be worth splitting.
const ZONE_META = {
  'b1-l': { name: 'Left of Six-Yard Box', narrative: 'the left of the six-yard box' },
  'b1-m': { name: 'Six-Yard Box', narrative: 'right in the six-yard box' },
  'b1-r': { name: 'Right of Six-Yard Box', narrative: 'the right of the six-yard box' },
  'b2-wl': { name: 'Left Byline', narrative: 'the left byline' },
  'b2-el': { name: 'Left of Box', narrative: 'the left of the box' },
  'b2-l': { name: 'Inside Left', narrative: 'inside-left of the box' },
  'b2-m': { name: 'Middle of Box', narrative: 'the middle of the box' },
  'b2-r': { name: 'Inside Right', narrative: 'inside-right of the box' },
  'b2-er': { name: 'Right of Box', narrative: 'the right of the box' },
  'b2-wr': { name: 'Right Byline', narrative: 'the right byline' },
  'b3-c': { name: 'Back of Box', narrative: 'the back of the box' },
  'b4-wl': { name: 'Long Range, Wide Left', narrative: 'long range, wide on the left' },
  'b4-l': { name: 'Long Range, Left of Box', narrative: 'long range, left of the box' },
  'b4-m': { name: 'Long Range, Central', narrative: 'long range, centrally' },
  'b4-r': { name: 'Long Range, Right of Box', narrative: 'long range, right of the box' },
  'b4-wr': { name: 'Long Range, Wide Right', narrative: 'long range, wide on the right' },
  'b5-c': { name: 'Very Long Range', narrative: 'from very long range, near the halfway line' },
};

const ZONE_SHAPES = {
  'b1-l': { x: SIX_YARD_L, y: DEPTH.d0, w: SIX_THIRD, h: DEPTH.d1 - DEPTH.d0 },
  'b1-m': { x: SIX_T1, y: DEPTH.d0, w: SIX_THIRD, h: DEPTH.d1 - DEPTH.d0 },
  'b1-r': { x: SIX_T2, y: DEPTH.d0, w: SIX_THIRD, h: DEPTH.d1 - DEPTH.d0 },
  // Byline + channel columns run the full box depth (d0 to d2) in one cell —
  // they flank the six-yard box on both sides, goal line to 18-yard line.
  'b2-wl': { x: 0, y: DEPTH.d0, w: BOX_L, h: DEPTH.d2 - DEPTH.d0 },
  'b2-el': { x: BOX_L, y: DEPTH.d0, w: SIX_YARD_L - BOX_L, h: DEPTH.d2 - DEPTH.d0 },
  'b2-l': { x: SIX_YARD_L, y: DEPTH.d1, w: SIX_THIRD, h: DEPTH.d1b - DEPTH.d1 },
  'b2-m': { x: SIX_T1, y: DEPTH.d1, w: SIX_THIRD, h: DEPTH.d1b - DEPTH.d1 },
  'b2-r': { x: SIX_T2, y: DEPTH.d1, w: SIX_THIRD, h: DEPTH.d1b - DEPTH.d1 },
  'b2-er': { x: SIX_YARD_R, y: DEPTH.d0, w: BOX_R - SIX_YARD_R, h: DEPTH.d2 - DEPTH.d0 },
  'b2-wr': { x: BOX_R, y: DEPTH.d0, w: 68 - BOX_R, h: DEPTH.d2 - DEPTH.d0 },
  'b3-c': { x: SIX_YARD_L, y: DEPTH.d1b, w: SIX_YARD_R - SIX_YARD_L, h: DEPTH.d2 - DEPTH.d1b },
  'b4-wl': { x: 0, y: DEPTH.d2, w: BOX_L, h: DEPTH.d3 - DEPTH.d2 },
  'b4-l': { x: BOX_L, y: DEPTH.d2, w: BOX_THIRD, h: DEPTH.d3 - DEPTH.d2 },
  'b4-m': { x: BOX_T1, y: DEPTH.d2, w: BOX_THIRD, h: DEPTH.d3 - DEPTH.d2 },
  'b4-r': { x: BOX_T2, y: DEPTH.d2, w: BOX_THIRD, h: DEPTH.d3 - DEPTH.d2 },
  'b4-wr': { x: BOX_R, y: DEPTH.d2, w: 68 - BOX_R, h: DEPTH.d3 - DEPTH.d2 },
  'b5-c': { x: 0, y: DEPTH.d3, w: 68, h: DEPTH.d4 - DEPTH.d3 },
};

const METRIC_META = {
  xg: { label: 'xG', zoneKey: 'xg', totalKey: 'totalXg', unit: 'xG', fmt: v => v.toFixed(1), noun: 'non-penalty xG' },
  goals: { label: 'Goals', zoneKey: 'goals', totalKey: 'totalGoals', unit: 'goals', fmt: v => String(v), noun: 'non-penalty goals' },
  shots: { label: 'Shots', zoneKey: 'shots', totalKey: 'totalShots', unit: 'shots', fmt: v => String(v), noun: 'shots' },
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
  const inSixWidth = cx >= SIX_YARD_L && cx <= SIX_YARD_R;
  const wide = cx < BOX_L ? 'wl' : cx > BOX_R ? 'wr' : null;
  const sixSide = cx < SIX_YARD_L ? 'l' : cx > SIX_YARD_R ? 'r' : null;

  if (cy <= DEPTH.d2) {
    // Anywhere in the box (goal line to 18-yard line). The byline and
    // channel columns span this whole depth in one cell each; only the
    // six-yard-width middle strip is further split into three depth bands:
    // the six-yard row (b1), the rest of the box (b2-l/m/r), and the back
    // of the box right before the 18-yard line (b3-c, one cell).
    if (!inBoxWidth) return `b2-${wide}`;
    if (!inSixWidth) return sixSide === 'l' ? 'b2-el' : 'b2-er';
    if (cy <= DEPTH.d1) return cx < SIX_T1 ? 'b1-l' : cx < SIX_T2 ? 'b1-m' : 'b1-r';
    if (cy <= DEPTH.d1b) return cx < SIX_T1 ? 'b2-l' : cx < SIX_T2 ? 'b2-m' : 'b2-r';
    return 'b3-c';
  }
  if (cy > DEPTH.d3) return 'b5-c'; // very long range — one zone, full width
  if (!inBoxWidth) return `b4-${wide}`;
  return cx < BOX_T1 ? 'b4-l' : cx < BOX_T2 ? 'b4-m' : 'b4-r';
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

function buildNarrative(a, team, mode, metric) {
  if (!a.totalShots) return [];
  const teamName = teamFullNames[team] || team;
  const entries = Object.entries(a.zones).filter(([, z]) => z.shots > 0);
  if (!entries.length) return [];
  const mm = METRIC_META[metric];
  const total = a[mm.totalKey];
  const verb = mode === 'for' ? 'create' : 'concede';
  const noun = mode === 'for' ? 'their shots' : 'shots faced';
  const lines = [];

  const [topKey, topAgg] = entries.slice().sort((x, y) => y[1][mm.zoneKey] - x[1][mm.zoneKey])[0];
  if (topAgg[mm.zoneKey] > 0 && total > 0) {
    const pct = Math.round(topAgg[mm.zoneKey] / total * 100);
    lines.push(`${teamName} ${verb} the most ${mm.noun} from ${ZONE_META[topKey].narrative} — ${mm.fmt(topAgg[mm.zoneKey])} ${mm.unit} (${pct}% of the total).`);
  }

  // Skip when the metric toggle is already "Goals" — this would just repeat the line above.
  if (metric !== 'goals' && a.totalGoals > 0) {
    const [topGoalKey, topGoalAgg] = entries.slice().sort((x, y) => y[1].goals - x[1].goals)[0];
    if (topGoalKey !== topKey) {
      const verbGoal = mode === 'for' ? 'scored' : 'conceded';
      lines.push(`Most non-penalty goals ${verbGoal} have come from ${ZONE_META[topGoalKey].narrative} (${topGoalAgg.goals} of ${a.totalGoals}).`);
    }
  }

  const totalCorners = entries.reduce((sum, [, z]) => sum + z.corners, 0);
  if (totalCorners > 0) {
    const pct = Math.round(totalCorners / a.totalShots * 100);
    lines.push(`${totalCorners} of ${a.totalShots} ${noun} (${pct}%) have come from corners.`);
  }

  return lines;
}

function narrativeBlock(a, team, mode, metric) {
  const lines = buildNarrative(a, team, mode, metric);
  if (!lines.length) return '';
  return `<ul class="shotmap-narrative">${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
}

function pitchMarkings() {
  return `
    <rect class="shotmap-line" x="0" y="0" width="68" height="52.5"></rect>
    <path class="shotmap-line" d="M 24.85 52.5 A 9.15 9.15 0 0 1 43.15 52.5"></path>
    <rect class="shotmap-line shotmap-box" x="13.84" y="0" width="40.32" height="16.5"></rect>
    <rect class="shotmap-line shotmap-box" x="24.84" y="0" width="18.32" height="5.5"></rect>
    <circle class="shotmap-spot" cx="34" cy="11" r="0.35"></circle>
    <path class="shotmap-line" d="M 26.7 16.5 A 9.15 9.15 0 0 0 41.3 16.5"></path>
  `;
}

// Open goal frame (no back line — it opens into the six-yard box) with a
// light net hatch, drawn above y=0 in the viewBox's extended top margin.
function goalFrame() {
  const gl = 30.34, gr = 37.66, gt = -3.6;
  const netCols = [1, 2, 3, 4, 5, 6].map(i => gl + (gr - gl) * i / 7);
  const netRows = [-1.2, -2.4];
  return `
    <g class="shotmap-goal">
      ${netCols.map(x => `<line class="shotmap-net" x1="${x.toFixed(2)}" y1="0" x2="${x.toFixed(2)}" y2="${gt}"></line>`).join('')}
      ${netRows.map(y => `<line class="shotmap-net" x1="${gl}" y1="${y}" x2="${gr}" y2="${y}"></line>`).join('')}
      <path class="shotmap-goal-frame" d="M ${gl} 0 L ${gl} ${gt} L ${gr} ${gt} L ${gr} 0"></path>
    </g>
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

function zoneFills(zones, metric) {
  const mk = METRIC_META[metric].zoneKey;
  const max = Math.max(...Object.values(zones).map(z => z[mk]), 0.0001);
  return Object.entries(ZONE_SHAPES).map(([key, s]) => {
    const agg = zones[key];
    if (!agg || agg.shots === 0) return '';
    const share = agg[mk] / max;
    const opacity = (0.14 + share * 0.6).toFixed(2);
    return `<rect class="shotmap-zone" data-zone="${key}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" style="fill:var(--accent);fill-opacity:${opacity}"></rect>`;
  }).join('');
}

function zoneLabels(zones, total, metric) {
  const mk = METRIC_META[metric].zoneKey;
  return Object.entries(ZONE_SHAPES).map(([key, s]) => {
    const agg = zones[key];
    if (!agg || agg.shots === 0) return '';
    const pct = total > 0 ? Math.round(agg[mk] / total * 100) : 0;
    const left = ((s.x + s.w / 2) / VIEW_W * 100).toFixed(1);
    const top = ((s.y + s.h / 2 - VIEW_Y_MIN) / VIEW_H * 100).toFixed(1);
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
  const mm = METRIC_META[root._metric];
  root._analysis = a;
  root.querySelector('.shotmap-summary').outerHTML = `<div class="shotmap-summary">${summaryRow(a, root._mode)}</div>`;
  root.querySelector('.shotmap-narrative-wrap').innerHTML = narrativeBlock(a, team, root._mode, root._metric);
  root.querySelector('.shotmap-scatter-layer').innerHTML = scatterDots(shots, root._mode);
  root.querySelector('.shotmap-zones').innerHTML = zoneFills(a.zones, root._metric);
  root.querySelector('.shotmap-zone-labels').innerHTML = zoneLabels(a.zones, a[mm.totalKey], root._metric);
  root.querySelector('.shotmap-legend-note').textContent =
    `% = share of ${mm.noun} by zone · shading follows the same share`;
  root.querySelector('.shotmap-tooltip').style.display = 'none';
}

function bindHover(root) {
  const wrap = root.querySelector('.shotmap-pitch-col');
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

function orientationArrow() {
  return `
    <div class="shotmap-orientation">
      <svg class="shotmap-arrow-icon" viewBox="0 0 20 70" preserveAspectRatio="xMidYMid meet">
        <line x1="10" y1="68" x2="10" y2="14"></line>
        <path d="M 2 20 L 10 4 L 18 20 Z"></path>
      </svg>
      <span class="shotmap-orientation-label">Attack</span>
    </div>
  `;
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
  bindHover(container);
  bindControls(container, team);
}

export { renderShotMap };
