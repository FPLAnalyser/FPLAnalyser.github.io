// nav.js — page navigation and card tab switching
import { loaded } from './data.js';

const pageRenderers = {};
function registerPage(name, fn) { pageRenderers[name] = fn; }

// ── Navigation ───────────────────────────────────────────────────────────────
function showPage(page, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  if (el) el.classList.add('active');
  if (loaded && pageRenderers[page]) pageRenderers[page]();
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function showTab(el, id) {
  const card = el.closest('.player-card') || el.closest('.team-card');
  card.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  card.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(id).classList.add('active');
}

window.showPage = showPage;
window.showTab = showTab;
export { showPage, showTab, registerPage };
