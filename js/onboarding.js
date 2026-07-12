// onboarding.js — first-visit welcome modal + a reusable "How it works" dialog.
const SEEN_KEY = 'fpl_onboarded';

const CONTENT = `
  <div class="modal-card" role="dialog" aria-modal="true" aria-label="Welcome to FPL Analyser">
    <div class="modal-logo">
      <img src="icons/icon-192.png" alt="" width="56" height="56">
      <div>
        <div class="modal-title">FPL Analyser</div>
        <div class="modal-sub">Data-driven analysis to give you the edge</div>
      </div>
    </div>
    <ul class="modal-list">
      <li><strong>Load Your Team</strong> — enter your FPL team ID for a personalised weekly report: weak spots, form and fixture swings, price risks, captaincy, and concrete transfer suggestions at your budget.</li>
      <li><strong>Player &amp; team ratings</strong> — every player scored out of 5 within their position, plus personas ("Poacher", "Set Piece Threat") and finance-style metrics (alpha, consistency, Sharpe).</li>
      <li><strong>Scouting report</strong> — compare up to four players on per-90 percentiles versus their peers, over the season or the last few gameweeks.</li>
    </ul>
    <div class="modal-tip">Tip: on your phone, tap the ⓘ icons to see what any rating or metric means. Add the site to your home screen for an app-like experience.</div>
    <button class="btn-primary modal-cta" id="modal-cta">Get started</button>
  </div>`;

function openModal() {
  let overlay = document.getElementById('onboard-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'onboard-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = CONTENT;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    overlay.querySelector('#modal-cta').addEventListener('click', closeModal);
  }
  overlay.classList.add('show');
}

function closeModal() {
  const overlay = document.getElementById('onboard-overlay');
  if (overlay) overlay.classList.remove('show');
  try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* private mode — fine */ }
}

// Show once on the first ever visit; the ⓘ nav button reopens it any time.
function initOnboarding() {
  let seen = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch (e) { /* ignore */ }
  if (!seen) openModal();
  const help = document.getElementById('nav-help');
  if (help) help.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
}

export { initOnboarding };
