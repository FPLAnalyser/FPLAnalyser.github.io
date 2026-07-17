// shotzones.js — shared Opta-style zone-grid geometry, classification, and
// rendering helpers for shot maps. Used by both the team shot map (attack +
// defence, js/shotmap.js) and the per-player zone map (attack only,
// js/playerzonemap.js) so the two stay visually and numerically consistent.
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
// It doubles as the near/far split for the flank columns beside the
// six-yard box (b2-el/er), so that boundary lines up into one clean
// horizontal line across the whole box rather than a line that only spans
// the middle third. d3 caps the "long range" band at 13.5m beyond the box
// (30m from goal) — past that, shots are rare enough that one big zone
// reads better than three thin ones. d2c splits that 16.5-30 band in half,
// so the near half (right outside the box) and far half (genuine long
// range) each get their own left/middle/right row.
const DEPTH = { d0: 0, d1: 5.5, d1b: 11, d2: 16.5, d2c: 23.25, d3: 30, d4: 52.5 };
const VIEW_Y_MIN = -5, VIEW_H = DEPTH.d4 - VIEW_Y_MIN, VIEW_W = 68;

// 22 zones, matching Opta-style end-location grids. The byline columns
// (b2-wl/wr, outside the box entirely) run the full box depth in one cell
// each side. The channel columns beside the six-yard box (b2-el/er) split
// into near/far at the same 11m line the middle strip already uses. The
// six-yard-width middle strip gets three depth bands: the six-yard row
// (b1), the rest of the box (b2-l/m/r), and the back of the box right
// before the 18-yard line (b3-c, a single cell — precise left/right
// position matters less that deep). From the box edge to 30m, the centre
// band splits into three columns aligned to the box's own thirds, in two
// depth rows: just outside the box (b4-l/m/r) and long range proper
// (b4b-l/m/r) — flanked the whole way by the wide, outside-the-box-width
// columns (b4-wl/wr, one cell each, full 16.5-30 depth). Beyond 30m, all
// the way to the halfway line, is one single zone (b5) — too far out to be
// worth splitting.
const ZONE_META = {
  'b1-l': { name: 'Left of Six-Yard Box', narrative: 'the left of the six-yard box' },
  'b1-m': { name: 'Six-Yard Box', narrative: 'right in the six-yard box' },
  'b1-r': { name: 'Right of Six-Yard Box', narrative: 'the right of the six-yard box' },
  'b2-wl': { name: 'Left Byline', narrative: 'the left byline' },
  'b2-el-n': { name: 'Left of Box, Near', narrative: 'the left of the box, close to goal' },
  'b2-el-f': { name: 'Left of Box, Far', narrative: 'the left of the box, further out' },
  'b2-l': { name: 'Inside Left', narrative: 'inside-left of the box' },
  'b2-m': { name: 'Middle of Box', narrative: 'the middle of the box' },
  'b2-r': { name: 'Inside Right', narrative: 'inside-right of the box' },
  'b2-er-n': { name: 'Right of Box, Near', narrative: 'the right of the box, close to goal' },
  'b2-er-f': { name: 'Right of Box, Far', narrative: 'the right of the box, further out' },
  'b2-wr': { name: 'Right Byline', narrative: 'the right byline' },
  'b3-c': { name: 'Back of Box', narrative: 'the back of the box' },
  'b4-wl': { name: 'Long Range, Wide Left', narrative: 'long range, wide on the left' },
  'b4-l': { name: 'Edge of Box, Left', narrative: 'just outside the box on the left' },
  'b4-m': { name: 'Edge of Box, Centre', narrative: 'just outside the box, centrally' },
  'b4-r': { name: 'Edge of Box, Right', narrative: 'just outside the box on the right' },
  'b4-wr': { name: 'Long Range, Wide Right', narrative: 'long range, wide on the right' },
  'b4b-l': { name: 'Long Range, Left of Box', narrative: 'long range, left of the box' },
  'b4b-m': { name: 'Long Range, Central', narrative: 'long range, centrally' },
  'b4b-r': { name: 'Long Range, Right of Box', narrative: 'long range, right of the box' },
  'b5-c': { name: 'Very Long Range', narrative: 'from very long range, near the halfway line' },
};

const ZONE_SHAPES = {
  'b1-l': { x: SIX_YARD_L, y: DEPTH.d0, w: SIX_THIRD, h: DEPTH.d1 - DEPTH.d0 },
  'b1-m': { x: SIX_T1, y: DEPTH.d0, w: SIX_THIRD, h: DEPTH.d1 - DEPTH.d0 },
  'b1-r': { x: SIX_T2, y: DEPTH.d0, w: SIX_THIRD, h: DEPTH.d1 - DEPTH.d0 },
  // Byline columns run the full box depth (d0 to d2) in one cell — they
  // flank the six-yard box on both sides, goal line to 18-yard line.
  'b2-wl': { x: 0, y: DEPTH.d0, w: BOX_L, h: DEPTH.d2 - DEPTH.d0 },
  // Channel columns split near/far at d1b, matching the six-yard strip's
  // own back-of-box boundary so the grid line runs unbroken across the box.
  'b2-el-n': { x: BOX_L, y: DEPTH.d0, w: SIX_YARD_L - BOX_L, h: DEPTH.d1b - DEPTH.d0 },
  'b2-el-f': { x: BOX_L, y: DEPTH.d1b, w: SIX_YARD_L - BOX_L, h: DEPTH.d2 - DEPTH.d1b },
  'b2-l': { x: SIX_YARD_L, y: DEPTH.d1, w: SIX_THIRD, h: DEPTH.d1b - DEPTH.d1 },
  'b2-m': { x: SIX_T1, y: DEPTH.d1, w: SIX_THIRD, h: DEPTH.d1b - DEPTH.d1 },
  'b2-r': { x: SIX_T2, y: DEPTH.d1, w: SIX_THIRD, h: DEPTH.d1b - DEPTH.d1 },
  'b2-er-n': { x: SIX_YARD_R, y: DEPTH.d0, w: BOX_R - SIX_YARD_R, h: DEPTH.d1b - DEPTH.d0 },
  'b2-er-f': { x: SIX_YARD_R, y: DEPTH.d1b, w: BOX_R - SIX_YARD_R, h: DEPTH.d2 - DEPTH.d1b },
  'b2-wr': { x: BOX_R, y: DEPTH.d0, w: 68 - BOX_R, h: DEPTH.d2 - DEPTH.d0 },
  'b3-c': { x: SIX_YARD_L, y: DEPTH.d1b, w: SIX_YARD_R - SIX_YARD_L, h: DEPTH.d2 - DEPTH.d1b },
  'b4-wl': { x: 0, y: DEPTH.d2, w: BOX_L, h: DEPTH.d3 - DEPTH.d2 },
  'b4-l': { x: BOX_L, y: DEPTH.d2, w: BOX_THIRD, h: DEPTH.d2c - DEPTH.d2 },
  'b4-m': { x: BOX_T1, y: DEPTH.d2, w: BOX_THIRD, h: DEPTH.d2c - DEPTH.d2 },
  'b4-r': { x: BOX_T2, y: DEPTH.d2, w: BOX_THIRD, h: DEPTH.d2c - DEPTH.d2 },
  'b4-wr': { x: BOX_R, y: DEPTH.d2, w: 68 - BOX_R, h: DEPTH.d3 - DEPTH.d2 },
  'b4b-l': { x: BOX_L, y: DEPTH.d2c, w: BOX_THIRD, h: DEPTH.d3 - DEPTH.d2c },
  'b4b-m': { x: BOX_T1, y: DEPTH.d2c, w: BOX_THIRD, h: DEPTH.d3 - DEPTH.d2c },
  'b4b-r': { x: BOX_T2, y: DEPTH.d2c, w: BOX_THIRD, h: DEPTH.d3 - DEPTH.d2c },
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
// "against" so the rendered picture is always in the analysed team's own
// frame. Player maps never pass mode — shots are always their own attack.
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
    // Anywhere in the box (goal line to 18-yard line). The byline columns
    // span this whole depth in one cell each; the channel columns beside
    // the six-yard box split near/far at d1b; the six-yard-width middle
    // strip is further split into three depth bands: the six-yard row
    // (b1), the rest of the box (b2-l/m/r), and the back of the box right
    // before the 18-yard line (b3-c, one cell).
    if (!inBoxWidth) return `b2-${wide}`;
    if (!inSixWidth) {
      const near = cy <= DEPTH.d1b;
      return sixSide === 'l' ? (near ? 'b2-el-n' : 'b2-el-f') : (near ? 'b2-er-n' : 'b2-er-f');
    }
    if (cy <= DEPTH.d1) return cx < SIX_T1 ? 'b1-l' : cx < SIX_T2 ? 'b1-m' : 'b1-r';
    if (cy <= DEPTH.d1b) return cx < SIX_T1 ? 'b2-l' : cx < SIX_T2 ? 'b2-m' : 'b2-r';
    return 'b3-c';
  }
  if (cy > DEPTH.d3) return 'b5-c'; // very long range — one zone, full width
  if (!inBoxWidth) return `b4-${wide}`; // wide flanks: one cell, full 16.5-30 depth
  if (cy <= DEPTH.d2c) return cx < BOX_T1 ? 'b4-l' : cx < BOX_T2 ? 'b4-m' : 'b4-r';
  return cx < BOX_T1 ? 'b4b-l' : cx < BOX_T2 ? 'b4b-m' : 'b4b-r';
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

// opts: { verb, shotsNoun, goalVerb } — phrasing supplied by the caller so
// this stays agnostic to whether the subject is a team (plural: "concede",
// "create") or a single player (singular: "creates").
function buildNarrative(a, subjectName, metric, opts) {
  if (!a.totalShots) return [];
  const entries = Object.entries(a.zones).filter(([, z]) => z.shots > 0);
  if (!entries.length) return [];
  const mm = METRIC_META[metric];
  const total = a[mm.totalKey];
  const { verb, shotsNoun, goalVerb } = opts;
  const lines = [];

  const [topKey, topAgg] = entries.slice().sort((x, y) => y[1][mm.zoneKey] - x[1][mm.zoneKey])[0];
  if (topAgg[mm.zoneKey] > 0 && total > 0) {
    const pct = Math.round(topAgg[mm.zoneKey] / total * 100);
    lines.push(`${subjectName} ${verb} the most ${mm.noun} from ${ZONE_META[topKey].narrative} — ${mm.fmt(topAgg[mm.zoneKey])} ${mm.unit} (${pct}% of the total).`);
  }

  // Skip when the metric toggle is already "Goals" — this would just repeat the line above.
  if (metric !== 'goals' && a.totalGoals > 0) {
    const [topGoalKey, topGoalAgg] = entries.slice().sort((x, y) => y[1].goals - x[1].goals)[0];
    if (topGoalKey !== topKey) {
      lines.push(`Most non-penalty goals ${goalVerb} have come from ${ZONE_META[topGoalKey].narrative} (${topGoalAgg.goals} of ${a.totalGoals}).`);
    }
  }

  const totalCorners = entries.reduce((sum, [, z]) => sum + z.corners, 0);
  if (totalCorners > 0) {
    const pct = Math.round(totalCorners / a.totalShots * 100);
    lines.push(`${totalCorners} of ${a.totalShots} ${shotsNoun} (${pct}%) have come from corners.`);
  }

  return lines;
}

function narrativeBlock(a, subjectName, metric, opts) {
  const lines = buildNarrative(a, subjectName, metric, opts);
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

function bindZoneHover(root) {
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

export {
  DEPTH, VIEW_Y_MIN, VIEW_H, VIEW_W, ZONE_META, ZONE_SHAPES, METRIC_META,
  distanceYards, toPitch, classifyZone, analyse, windowShots, venueFilterShots,
  buildNarrative, narrativeBlock, pitchMarkings, goalFrame, cellOutlines,
  zoneFills, zoneLabels, tooltipText, orientationArrow, bindZoneHover,
};
