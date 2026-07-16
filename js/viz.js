// viz.js — hand-built SVG visual helpers. Pure string-returning functions
// (same pattern as the page templates); animation hooks come from fx.js.

const TONE_COLOR = {
  good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)',
  info: 'var(--info)', brand: 'url(#grad-brand)',
};

// Radial gauge: value out of max as a rounded donut arc. The centre number is
// a data-count element so fx.animateCounters() counts it up on scroll.
// data-sort carries the raw value for table sorting if placed in a cell.
function radialGauge(value, max = 100, label = '', { size = 108, tone = 'brand' } = {}) {
  if (value == null || isNaN(value)) return '';
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, value / max));
  const color = TONE_COLOR[tone] || TONE_COLOR.brand;
  return `<div class="gauge" data-sort="${value}" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}"
        transform="rotate(-90 ${size / 2} ${size / 2})" class="gauge-arc"/>
    </svg>
    <div class="gauge-center">
      <div class="gauge-value num" data-count="${Math.round(value)}">0</div>
      ${label ? `<div class="gauge-label">${label}</div>` : ''}
    </div>
  </div>`;
}

// Sparkline: polyline with a soft gradient area fill and a glowing last point.
function sparkline(values, { w = 220, h = 48, tone = 'brand', id = 'spark' } = {}) {
  const vals = (values || []).map(Number).filter(v => !isNaN(v));
  if (vals.length < 2) return '';
  const min = Math.min(...vals), maxV = Math.max(...vals);
  const span = maxV - min || 1;
  const pad = 4;
  const x = (i) => pad + i * (w - pad * 2) / (vals.length - 1);
  const y = (v) => h - pad - (v - min) * (h - pad * 2) / span;
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lineColor = tone === 'brand' ? 'var(--brand)' : (TONE_COLOR[tone] || 'var(--brand)');
  const gid = `${id}-${Math.random().toString(36).slice(2, 7)}`;
  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${x(0).toFixed(1)},${h - pad} ${pts} ${x(vals.length - 1).toFixed(1)},${h - pad}" fill="url(#${gid})"/>
    <polyline points="${pts}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x(vals.length - 1).toFixed(1)}" cy="${y(vals[vals.length - 1]).toFixed(1)}" r="3" fill="${lineColor}" class="spark-dot"/>
  </svg>`;
}

// Mini bar for table cells: the value over a rounded track sized by value/max.
// Rendered at width 0 with data-reveal-width so fx.revealBars() sweeps it in.
function miniBar(value, max, { tone = 'brand', text = null } = {}) {
  const v = Number(value);
  if (isNaN(v) || !max) return text ?? (value == null ? 'N/A' : String(value));
  const widthPct = Math.max(2, Math.min(100, v / max * 100)).toFixed(0);
  const color = tone === 'brand' ? 'var(--brand)' : (TONE_COLOR[tone] || 'var(--brand)');
  return `<div class="minibar" data-sort="${v}">
    <span class="minibar-value num">${text ?? value}</span>
    <span class="minibar-track"><span class="minibar-fill" style="width:0;background:${color}" data-reveal-width="${widthPct}%"></span></span>
  </div>`;
}

export { radialGauge, sparkline, miniBar };
