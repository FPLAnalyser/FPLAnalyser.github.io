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
      <li><strong>The Briefing</strong> — the story of the week on the home page: captaincy verdicts, fixture swings and form that's backed by the underlying numbers, told in plain language.</li>
      <li><strong>My Team</strong> — enter your FPL team ID for a personalised weekly report: weak spots, fixture swings, price risks, captaincy, and concrete transfer suggestions at your budget.</li>
      <li><strong>Analytics</strong> — every player rated out of 5 within their position, with a plain-language verdict, personas ("Poacher", "Set Piece Threat"), shot maps and rankings.</li>
      <li><strong>Scouting</strong> — compare up to four players on per-90 percentiles versus their peers, with an automatic head-to-head verdict.</li>
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
