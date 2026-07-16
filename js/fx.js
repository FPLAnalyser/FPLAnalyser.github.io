// fx.js — premium interaction layer: animated counters, scroll-triggered
// reveals and skeleton loading states. Everything respects reduced motion.

const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function fmtCount(n, format) {
  switch (format) {
    case '1dp': return n.toFixed(1);
    case '2dp': return n.toFixed(2);
    default: return Math.round(n).toLocaleString('en-GB');
  }
}

function finalText(el) {
  const n = Number(el.dataset.count);
  const text = isNaN(n) ? el.dataset.count : fmtCount(n, el.dataset.countFormat);
  return (el.dataset.countPrefix || '') + text + (el.dataset.countSuffix || '');
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function runCounter(el) {
  const target = Number(el.dataset.count);
  if (isNaN(target)) { el.textContent = finalText(el); return; }
  const prefix = el.dataset.countPrefix || '';
  const suffix = el.dataset.countSuffix || '';
  const format = el.dataset.countFormat;
  const duration = 650;
  const start = performance.now();
  function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    el.textContent = prefix + fmtCount(target * easeOutCubic(t), format) + suffix;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

let counterObserver = null;
function getCounterObserver() {
  if (!counterObserver) {
    counterObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        counterObserver.unobserve(entry.target);
        runCounter(entry.target);
      });
    }, { threshold: 0.4 });
  }
  return counterObserver;
}

// Animate every [data-count] under root that hasn't run yet. Numbers count up
// from zero when scrolled into view; with reduced motion they render final.
function animateCounters(root = document) {
  root.querySelectorAll('[data-count]:not([data-counted])').forEach((el) => {
    el.dataset.counted = '1';
    if (REDUCED || !('IntersectionObserver' in window)) {
      el.textContent = finalText(el);
    } else {
      getCounterObserver().observe(el);
    }
  });
}

let barObserver = null;
function getBarObserver() {
  if (!barObserver) {
    barObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        barObserver.unobserve(entry.target);
        entry.target.style.width = entry.target.dataset.revealWidth;
      });
    }, { threshold: 0.3 });
  }
  return barObserver;
}

// Sweep bar fills ([data-reveal-width], rendered at width 0) into place when
// they scroll into view. CSS transitions handle the easing.
function revealBars(root = document) {
  root.querySelectorAll('[data-reveal-width]:not([data-revealed])').forEach((el) => {
    el.dataset.revealed = '1';
    if (REDUCED || !('IntersectionObserver' in window)) {
      el.style.width = el.dataset.revealWidth;
    } else {
      getBarObserver().observe(el);
    }
  });
}

// ── Skeleton loading states ──────────────────────────────────────────────────
function skeletonTable(rows = 6) {
  const line = '<div class="skel" style="height:40px"></div>';
  return `<div class="skel-card"><div class="skel-block">
    <div class="skel" style="height:14px;width:30%"></div>
    ${line.repeat(rows)}
  </div></div>`;
}

function skeletonCards(n = 3) {
  const card = `<div class="skel-card"><div class="skel-block">
    <div class="skel" style="height:16px;width:45%"></div>
    <div class="skel" style="height:44px"></div>
    <div class="skel" style="height:44px"></div>
    <div class="skel" style="height:44px"></div>
  </div></div>`;
  return `<div class="home-columns">${card.repeat(Math.min(n, 2))}</div>${n > 2 ? card.repeat(n - 2) : ''}`;
}

function skeletonHero() {
  return `<div class="skel-card"><div class="skel-block" style="flex-direction:row;align-items:center;gap:20px">
    <div class="skel" style="width:96px;height:96px;border-radius:50%;flex-shrink:0"></div>
    <div style="flex:1;display:flex;flex-direction:column;gap:10px">
      <div class="skel" style="height:18px;width:45%"></div>
      <div class="skel" style="height:12px;width:80%"></div>
      <div class="skel" style="height:12px;width:70%"></div>
      <div class="skel" style="height:12px;width:60%"></div>
    </div>
  </div></div>`;
}

// Skeleton rectangle roughly matching the shot-map pitch aspect ratio
function skeletonPitch() {
  return `<div class="skel" style="max-width:500px;margin:0 auto;aspect-ratio:105/74;border-radius:10px"></div>`;
}

export { REDUCED, animateCounters, revealBars, skeletonTable, skeletonCards, skeletonHero, skeletonPitch };
