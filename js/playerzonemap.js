// playerzonemap.js — per-player zone-grid shot map (Understat data).
//
// The same Opta-style zone grid used on the team page's Attack view
// (js/shotzones.js), scoped to one player's own shots, supplementing the
// scatter shot map (js/playershotmap.js) on the player's Shots tab. Attack
// only — a player doesn't "concede" — and no venue filter, since per-shot
// venue isn't recorded in player_shots.json. All figures exclude penalties.
import { loadPlayerShots } from './playershotmap.js';
import {
  VIEW_Y_MIN, VIEW_H, VIEW_W, METRIC_META,
  analyse, windowShots, narrativeBlock,
  pitchMarkings, goalFrame, cellOutlines, zoneFills, zoneLabels,
  orientationArrow, bindZoneHover,
} from './shotzones.js';

const NARRATIVE_OPTS = { verb: 'creates', shotsNoun: 'shots taken', goalVerb: 'scored' };

function controlsRow() {
  return `
    <div class="shotmap-controls">
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
    </div>
  `;
}

function currentSlice(root) {
  return windowShots(root._allShots, root._window);
}

function rerender(root, name) {
  const shots = currentSlice(root);
  // Passing 'against' here isn't about defence — it selects shotzones.js's
  // toPitch flip branch (cx = 68 - y*68), which is the formula that plots
  // player_shots.json's raw x/y correctly. That's the exact same math as
  // playershotmap.js's own toPitch, confirmed against real shot locations;
  // shots_for.json (team attack) is pre-processed differently upstream and
  // needs the *unflipped* branch instead, which is why the team map's own
  // Attack view correctly passes 'for'.
  const a = analyse(shots, 'against');
  const mm = METRIC_META[root._metric];
  root._analysis = a;
  root.querySelector('.shotmap-narrative-wrap').innerHTML = narrativeBlock(a, name, root._metric, NARRATIVE_OPTS);
  root.querySelector('.shotmap-zones').innerHTML = zoneFills(a.zones, root._metric);
  root.querySelector('.shotmap-zone-labels').innerHTML = zoneLabels(a.zones, a[mm.totalKey], root._metric);
  root.querySelector('.shotmap-legend-note').textContent =
    `% = share of ${mm.noun} by zone · shading follows the same share`;
  root.querySelector('.shotmap-tooltip').style.display = 'none';
}

function bindControls(root, name) {
  root.querySelectorAll('.shotmap-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.parentElement.querySelectorAll('.shotmap-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.window) root._window = btn.dataset.window;
      if (btn.dataset.metric) root._metric = btn.dataset.metric;
      rerender(root, name);
    });
  });
}

async function renderPlayerZoneMap(element, name, container) {
  if (!container) return;
  container.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px 0">Loading shot data…</div>';
  const all = await loadPlayerShots();
  const shots = (all[String(element)] || []).filter(s => s.situation !== 'Penalty');

  if (!shots.length) {
    container.innerHTML = `<div style="color:var(--text2);font-size:13px;padding:12px 0">
      No non-penalty shots recorded for this player yet.</div>`;
    return;
  }

  container.innerHTML = `
    ${controlsRow()}
    <div class="shotmap-narrative-wrap"></div>
    <div class="shotmap-wrap">
      ${orientationArrow()}
      <div class="shotmap-pitch-col">
        <svg class="shotmap-pitch" viewBox="0 ${VIEW_Y_MIN} ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid meet">
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
  container._allShots = shots;
  container._window = 'season';
  container._metric = 'xg';
  rerender(container, name);
  bindZoneHover(container);
  bindControls(container, name);
}

export { renderPlayerZoneMap };
