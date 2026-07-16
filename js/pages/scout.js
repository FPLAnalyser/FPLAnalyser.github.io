// scout.js — scouting report (percentile comparison)
import { data, loadTable } from '../data.js';
import { teamFullNames, teamBadgeImg, norm } from '../util.js';

// Goals/assists read oddly as a per-90 decimal ("0.82 goals") — show the
// whole-number total for the window instead. Percentiles still rank the
// per-90 rate underneath (fair across different minutes played); only the
// displayed figure changes.
const WHOLE_NUMBER_KEYS = new Set(['goals', 'assists']);

// Scouting data loads separately so a missing file never breaks the site
function loadScoutData() {
  Promise.all([loadTable('scouting', 'scouting_percentiles.csv'),
               loadTable('scouting_meta', 'scouting_stat_meta.csv')])
    .then(([scout, scoutMeta]) => {
      if (!scout.length || !scout[0].web_name) throw new Error('bad scouting CSV');
      data.scout = scout;
      data.scoutMeta = scoutMeta;
      initScoutSearch();
    })
    .catch(err => {
      console.error('Scouting data unavailable:', err);
      document.getElementById('scout-report').innerHTML =
        '<div class="scout-empty">Scouting data isn\'t available yet.<br><span>Run scouting_percentiles.py and push scouting_percentiles.csv + scouting_stat_meta.csv to the repo.</span></div>';
    });
}

// ── Scouting Report ──────────────────────────────────────────────────────────
const SCOUT_MAX = 4;
// Deliberately excludes every hue used by the single-player percentile scale
// (scoutPctColor: red -> grey -> green) so a multi-player bar's colour is
// never mistaken for a percentile reading. Validated for CVD separation and
// contrast against the card surface (dataviz skill's categorical checks).
const SCOUT_COLORS = ['#5EA7F7', '#E8A13C', '#E2649B', '#8B7BF4'];
let scoutSelected = [];
let scoutWindow = 'season';   // 'season' | 'l6' | 'l4'
let scoutPeer = 'pooled';     // 'pooled' (MID+FWD) | 'position'

const SCOUT_WINDOW_LABELS = { season: 'season to date', l6: 'last 6 gameweeks', l4: 'last 4 gameweeks' };

function setScoutWindow(w, el) {
  scoutWindow = w;
  document.querySelectorAll('#scout-window-tabs .rankings-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderScoutReport();
}

function setScoutPeer(p, el) {
  scoutPeer = p;
  document.querySelectorAll('#scout-peer-tabs .rankings-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderScoutReport();
}

// Rows for the current window; falls back to treating rows without a window
// column as season data (older CSVs).
function scoutRow(element) {
  return data.scout.find(p => p.element === element && (p.window || 'season') === scoutWindow);
}

function scoutPct(row, key) {
  if (scoutPeer === 'position' && row[key + '_pct_pos'] !== undefined) {
    const v = row[key + '_pct_pos'];
    return (v === '' || v == null) ? null : v;
  }
  const v = row[key + '_pct'];
  return (v === '' || v == null) ? null : v;
}

// FBref-style percentile colour: red (poor) → grey → green (elite)
function scoutPctColor(p) {
  if (p === '' || p == null) return '#5D6C80';
  const stops = [[1,[176,58,62]],[25,[186,108,70]],[50,[122,122,122]],[75,[92,160,96]],[99,[46,176,92]]];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++)
    if (p >= stops[i][0] && p <= stops[i+1][0]) { lo = stops[i]; hi = stops[i+1]; break; }
  const t = (p - lo[0]) / (hi[0] - lo[0] || 1);
  const c = lo[1].map((v, i) => Math.round(v + (hi[1][i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function renderScoutChips() {
  const el = document.getElementById('scout-chips');
  el.innerHTML = scoutSelected.map((p, i) => `
    <div class="scout-chip lift" style="--pc:${SCOUT_COLORS[i]}">
      ${p.code ? `<img loading="lazy" src="https://resources.premierleague.com/premierleague/photos/players/110x140/p${p.code}.png" onerror="this.style.display='none'">` : ''}
      <div><div class="nm">${p.web_name}</div><div class="tm">${teamBadgeImg(p.team, 12)}${teamFullNames[p.team] || p.team} · ${p.position} · ${p.minutes} mins</div></div>
      <button aria-label="Remove ${p.web_name}" onclick="removeScoutPlayer(${i})">×</button>
    </div>`).join('');
}

function removeScoutPlayer(i) {
  scoutSelected.splice(i, 1);
  renderScoutChips();
  renderScoutReport();
}

function renderScoutReport() {
  const report = document.getElementById('scout-report');
  const warn = document.getElementById('scout-warn');
  warn.style.display = 'none';

  if (scoutSelected.length === 0) {
    report.innerHTML = `<div class="scout-empty">Search for a player to build their scouting report.<br>
      <span>Percentiles ranked within peer group, ${SCOUT_WINDOW_LABELS[scoutWindow]}.</span></div>`;
    return;
  }

  const warnings = [];

  // GKP percentiles are ranked vs keepers — mixing panels would mislead
  const hasGK = scoutSelected.some(p => p.position === 'GKP');
  const hasOut = scoutSelected.some(p => p.position !== 'GKP');
  if (hasGK && hasOut) {
    warnings.push("Goalkeepers are ranked against other keepers, so they can't share bars with outfield players. Showing outfield players only.");
  }
  const shownSel = (hasGK && hasOut) ? scoutSelected.filter(p => p.position !== 'GKP') : scoutSelected;

  // Resolve each selected player's row for the active window (players can
  // fall below the minutes floor in short windows).
  const shown = shownSel.map(p => ({ sel: p, row: scoutRow(p.element) }));
  const missing = shown.filter(s => !s.row).map(s => s.sel.web_name);
  if (missing.length) {
    warnings.push(`No ${SCOUT_WINDOW_LABELS[scoutWindow]} data for ${missing.join(', ')} — not enough minutes in this window.`);
  }

  if (shown.length >= 3 && window.innerWidth < 640) {
    warnings.push('Tip: comparisons read best with 2 players on a phone.');
  }

  if (warnings.length) {
    warn.textContent = warnings.join(' ');
    warn.style.display = 'block';
  }

  const gkMode = shownSel.every(p => p.position === 'GKP');
  const rows = data.scoutMeta.filter(m => gkMode ? m.group === 'Goalkeeping' : m.group !== 'Goalkeeping');
  const multi = shown.length > 1;

  let html = '';
  if (multi) {
    html += `<div class="scout-colheads"><div></div><div class="scout-cells">`;
    shown.forEach((s, i) => {
      html += `<div class="who"><span class="scout-dot" style="background:${SCOUT_COLORS[i]}"></span>${s.sel.web_name}&nbsp;<span style="color:var(--text2);font-size:11px;font-weight:400">${teamBadgeImg(s.sel.team, 12)}${s.sel.team} · ${s.sel.position}</span></div>`;
    });
    html += `</div></div>`;
  }

  let currentGroup = null;
  rows.forEach(m => {
    if (m.group !== currentGroup) {
      currentGroup = m.group;
      html += `<div class="scout-grp">${m.group}</div>`;
    }
    html += `<div class="scout-row"><div class="lbl">${m.label}</div><div class="scout-cells">`;
    shown.forEach((s, i) => {
      const v = s.row ? s.row[m.key + '_per90'] : null;
      if (v === '' || v == null) {
        html += `<div class="scout-cell na"><span class="v">—</span><span class="p">n/a</span><div class="scout-bar"></div></div>`;
      } else {
        const pct = scoutPct(s.row, m.key);
        // Single player keeps the red→green percentile scale; with 2+ players
        // each player's bars take their own colour, matching the key above.
        const barColor = multi ? SCOUT_COLORS[i] : scoutPctColor(pct);
        const isWhole = WHOLE_NUMBER_KEYS.has(m.key) && s.row[m.key + '_total'] != null;
        const displayVal = isWhole ? Math.round(s.row[m.key + '_total']) : Number(v).toFixed(2);
        html += `<div class="scout-cell">
          <span class="v">${displayVal}</span>
          <span class="p">${pct ?? '—'}</span>
          <div class="scout-bar"><i style="width:${pct ?? 0}%;background:${barColor}"></i></div>
        </div>`;
      }
    });
    html += `</div></div>`;
  });
  report.innerHTML = html;
}

function initScoutSearch() {
  const input = document.getElementById('scout-search');
  const sugg = document.getElementById('scout-suggestions');
  const pool = data.scout.filter(p => (p.window || 'season') === 'season');
  input.placeholder = `Search ${pool.length} eligible players… (up to 4)`;

  input.addEventListener('input', () => {
    const q = norm(input.value.trim());
    if (q.length < 2) { sugg.style.display = 'none'; return; }
    const hits = pool.filter(p =>
      norm(p.web_name).includes(q) &&
      !scoutSelected.some(s => s.element === p.element)).slice(0, 8);
    if (!hits.length) { sugg.style.display = 'none'; return; }
    sugg.innerHTML = hits.map((p, i) =>
      `<div data-si="${i}">${p.web_name}<span class="meta">${teamBadgeImg(p.team, 12)}${p.team} · ${p.position}</span></div>`).join('');
    sugg.style.display = 'block';
    sugg.querySelectorAll('[data-si]').forEach((d, i) => d.addEventListener('click', () => {
      if (scoutSelected.length >= SCOUT_MAX) return;
      scoutSelected.push(hits[i]);
      input.value = ''; sugg.style.display = 'none';
      renderScoutChips(); renderScoutReport();
    }));
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.scout-picker')) sugg.style.display = 'none';
  });
}

window.setScoutWindow = setScoutWindow;
window.setScoutPeer = setScoutPeer;
window.removeScoutPlayer = removeScoutPlayer;
export { loadScoutData, initScoutSearch };
