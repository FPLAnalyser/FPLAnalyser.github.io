// app.js — entry point: loads data, registers pages, wires global listeners
import { loadAll, loaded, data } from './data.js';
import { registerPage } from './nav.js';
import { renderHome } from './pages/home.js';
import { renderPlayersDefault, initSearch } from './pages/players.js';
import { renderTeamsDefault } from './pages/teams.js';
import { showRankingsTab } from './pages/rankings.js';
import { loadScoutData } from './pages/scout.js';
import { initMyTeam } from './pages/myteam.js';

registerPage('home', renderHome);
registerPage('player', renderPlayersDefault);
registerPage('teams', renderTeamsDefault);

// Position tooltips to avoid screen edges
function positionTooltip(wrap) {
  const box = wrap.querySelector('.tooltip-box');
  if (!box) return;
  const rect = wrap.getBoundingClientRect();
  box.style.top = (rect.bottom + 8) + 'px';
  box.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
}

document.addEventListener('mouseover', e => {
  const wrap = e.target.closest('.tooltip-wrap');
  if (wrap) positionTooltip(wrap);
});

// Tap-to-toggle tooltips for touch screens (hover doesn't exist there)
document.addEventListener('click', e => {
  const wrap = e.target.closest('.tooltip-wrap');
  document.querySelectorAll('.tooltip-wrap.tooltip-open').forEach(w => {
    if (w !== wrap) w.classList.remove('tooltip-open');
  });
  if (wrap && wrap.querySelector('.tooltip-box')) {
    wrap.classList.toggle('tooltip-open');
    if (wrap.classList.contains('tooltip-open')) positionTooltip(wrap);
  }
});

// ── Data staleness banner ─────────────────────────────────────────────────────
function checkStaleness(meta) {
  console.log('site data meta:', meta);
  const banner = document.getElementById('stale-banner');
  if (!banner || !meta || !meta.generated_at) return;
  const ageDays = (Date.now() - new Date(meta.generated_at).getTime()) / 86400000;
  if (ageDays > 8) {
    const date = new Date(meta.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    banner.textContent = `⚠️ Data last updated ${date} (${Math.floor(ageDays)} days ago)`;
    banner.classList.add('show');
  }
}

// ── Sortable Tables ──────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!th || !th.textContent.trim()) return;
  const table = th.closest('table');
  const tbody = table && table.querySelector('tbody');
  if (!table || !tbody || !th.closest('thead')) return;

  const headerCells = Array.from(th.parentElement.children);
  const colIndex = headerCells.indexOf(th);
  const rows = Array.from(tbody.querySelectorAll('tr'));

  const getValue = (row) => {
    const cell = row.children[colIndex];
    return cell ? cell.textContent.trim() : '';
  };

  // Star ratings (e.g. "⭐⭐⭐½") render as text but should sort by star count.
  const parseNumeric = (text) => {
    if (text === '' || text.toUpperCase() === 'N/A') return null;
    if (/^[⭐½\s]+$/.test(text)) {
      const stars = (text.match(/⭐/g) || []).length;
      const halves = (text.match(/½/g) || []).length;
      return stars + halves * 0.5;
    }
    const n = parseFloat(text.replace(/[£%,+]/g, ''));
    return isNaN(n) ? undefined : n;
  };

  const isNumeric = rows.every(row => parseNumeric(getValue(row)) !== undefined);

  const dir = table.dataset.sortCol === String(colIndex) && table.dataset.sortDir === 'asc' ? 'desc' : 'asc';

  rows.sort((rowA, rowB) => {
    const a = getValue(rowA), b = getValue(rowB);
    if (isNumeric) {
      const aNum = parseNumeric(a);
      const bNum = parseNumeric(b);
      if (aNum === null && bNum === null) return 0;
      if (aNum === null) return 1;
      if (bNum === null) return -1;
      return dir === 'asc' ? aNum - bNum : bNum - aNum;
    }
    if (a === '' && b === '') return 0;
    if (a === '') return 1;
    if (b === '') return -1;
    return dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
  });

  rows.forEach(row => tbody.appendChild(row));

  table.dataset.sortCol = colIndex;
  table.dataset.sortDir = dir;
  headerCells.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
  th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadAll();
  if (!loaded) return;
  checkStaleness(data.meta);
  initSearch();
  renderHome();
  showRankingsTab('top-rated', document.querySelector('#page-rankings .rankings-tab'));
  loadScoutData();
  initMyTeam();
}
init();
