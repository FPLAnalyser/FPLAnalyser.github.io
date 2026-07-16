// nav.js — page navigation and card tab switching
import { loaded } from './data.js';

const pageRenderers = {};
function registerPage(name, fn) { pageRenderers[name] = fn; }

// ── Navigation ───────────────────────────────────────────────────────────────
function showPage(page, el) {
  const target = document.getElementById('page-' + page);
  if (!target) return;
  const apply = () => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    target.classList.add('active');
    const link = el || document.querySelector(`.nav-links a[href="#${page}"]`);
    if (link) link.classList.add('active');
  };
  // Smooth cross-fade where the View Transitions API exists; the CSS pageIn
  // animation remains the universal fallback (it re-runs on class re-add).
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(apply);
  } else {
    apply();
  }
  // Shareable page-level URLs (#home, #rankings, …) without history spam
  if (location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
  if (loaded && pageRenderers[page]) pageRenderers[page]();
}

// Back/forward and hand-typed hashes navigate too
window.addEventListener('hashchange', () => {
  const page = location.hash.slice(1);
  if (page && document.getElementById('page-' + page)) showPage(page);
});

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
