/* Deterministic, frame-addressable timeline.
 *
 * Nothing here runs on a clock: the renderer calls window.__setFrame(n) and the
 * whole stage is recomputed from n alone. That is what makes a 3600-frame
 * render reproducible instead of dependent on how fast the machine happened to
 * be going. */

const FPS = 60
const DURATION = 60            // seconds
const TOTAL = FPS * DURATION   // 3600 frames
const W = 1920
const H = 1080

// ---------------------------------------------------------------- easing
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5)
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const lerp = (a, b, t) => a + (b - a) * t

/** Progress through [start, start+dur], eased. */
const seg = (t, start, dur, ease = easeOutCubic) => ease(clamp01((t - start) / dur))

// ---------------------------------------------------------------- beats
// start/end in seconds; fin/fout are the cross-dissolve envelopes. Every beat
// overlaps its neighbour, which is why the film has no hard cuts.
const BEATS = {
  open:     { el: '#b-open',     start: 0.00,  end: 5.20,  fin: 0.45, fout: 0.70 },
  type1:    { el: '#b-type1',    start: 4.75,  end: 9.70,  fin: 0.40, fout: 0.60 },
  table:    { el: '#b-table',    start: 9.20,  end: 18.20, fin: 0.55, fout: 0.65 },
  inputs:   { el: '#b-inputs',   start: 17.70, end: 23.90, fin: 0.45, fout: 0.55 },
  fixtures: { el: '#b-fixtures', start: 23.45, end: 31.00, fin: 0.55, fout: 0.65 },
  captain:  { el: '#b-captain',  start: 30.45, end: 38.30, fin: 0.55, fout: 0.65 },
  squad:    { el: '#b-squad',    start: 37.75, end: 44.10, fin: 0.55, fout: 0.60 },
  plan:     { el: '#b-plan',     start: 43.60, end: 48.30, fin: 0.50, fout: 0.60 },
  type2:    { el: '#b-type2',    start: 47.80, end: 53.10, fin: 0.45, fout: 0.60 },
  end:      { el: '#b-end',      start: 52.60, end: 60.00, fin: 0.60, fout: 0.00 },
}

for (const b of Object.values(BEATS)) b.node = document.querySelector(b.el)

/** Local time within a beat, or null when the beat is not on screen. */
function local(b, t) {
  if (t < b.start || t > b.end) return null
  return t - b.start
}

/** Cross-dissolve envelope: fade up, hold, fade down. */
function envelope(b, t) {
  const lt = local(b, t)
  if (lt === null) return 0
  const len = b.end - b.start
  const up = b.fin > 0 ? easeOutCubic(clamp01(lt / b.fin)) : 1
  const down = b.fout > 0 ? easeOutCubic(clamp01((len - lt) / b.fout)) : 1
  return up * down
}

// ---------------------------------------------------------------- camera
/** Frame a page-space point at canvas centre with `visW` page px across. */
function camera(inner, cx, cy, visW) {
  const k = W / visW
  inner.style.transform =
    `translate(${W / 2}px, ${H / 2}px) scale(${k}) translate(${-cx}px, ${-cy}px)`
}

/** Interpolate a camera through keyframes; zoom is geometric so the push reads
 *  as constant speed rather than slowing as it tightens. */
function cameraKeys(inner, lt, keys) {
  let a = keys[0], b = keys[keys.length - 1]
  for (let i = 0; i < keys.length - 1; i++) {
    if (lt >= keys[i].t && lt <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break }
  }
  if (lt <= keys[0].t) { a = b = keys[0] }
  if (lt >= keys[keys.length - 1].t) { a = b = keys[keys.length - 1] }
  const span = b.t - a.t
  const p = span > 0 ? easeInOutCubic(clamp01((lt - a.t) / span)) : 0
  camera(inner, lerp(a.cx, b.cx, p), lerp(a.cy, b.cy, p),
         Math.exp(lerp(Math.log(a.w), Math.log(b.w), p)))
}

// ---------------------------------------------------------------- setup
let PLATES = null
const inner = (k) => document.querySelector(`.plate-inner[data-plate="${k}"]`)

/** Split each type line into word spans so they can land on a stagger. */
function splitWords() {
  for (const line of document.querySelectorAll('.line')) {
    const out = []
    for (const node of [...line.childNodes]) {
      if (node.nodeType === 3) {
        for (const word of node.textContent.split(/(\s+)/)) {
          if (!word) continue
          if (/^\s+$/.test(word)) { out.push(document.createTextNode(word)); continue }
          const s = document.createElement('span'); s.className = 'w'; s.textContent = word
          out.push(s)
        }
      } else {
        const s = document.createElement('span'); s.className = 'w'
        s.appendChild(node); out.push(s)
      }
    }
    line.replaceChildren(...out)
  }
}

/** One opaque panel per ranking row, positioned from the measured DOM rects. */
function buildRowMasks() {
  const host = inner('players')
  const rows = PLATES.players.rows.slice(0, 13)
  rows.forEach((r) => {
    const d = document.createElement('div')
    d.className = 'rowmask'
    d.style.left = `${r.x}px`; d.style.top = `${r.y}px`
    d.style.width = `${r.w}px`; d.style.height = `${r.h + 1}px`
    host.appendChild(d)
  })
  return [...host.querySelectorAll('.rowmask')]
}

function buildSweep() {
  const t = PLATES.fixtures.table
  const s = document.querySelector('#b-fixtures .sweep')
  s.style.left = `${t.x}px`; s.style.top = `${t.y - 40}px`
  s.style.width = `${t.w + 120}px`; s.style.height = `${t.h + 80}px`
  return s
}

let ROWMASKS = [], SWEEP = null

// ---------------------------------------------------------------- render
function setFrame(f) {
  const t = f / FPS

  for (const b of Object.values(BEATS)) {
    const o = envelope(b, t)
    b.node.style.opacity = o.toFixed(4)
    b.node.style.display = o < 0.001 ? 'none' : 'block'
  }

  // -- 1 · cold open: the rating counts up to the real value ---------------
  {
    const b = BEATS.open, lt = local(b, t)
    if (lt !== null) {
      const top = PLATES.players.figures.rows[0]
      const target = parseInt(top.rating, 10)
      const n = Math.round(lerp(0, target, seg(lt, 0.45, 2.15, easeOutExpo)))
      const num = document.getElementById('open-num')
      num.textContent = String(n)
      const kick = document.getElementById('open-kicker')
      kick.style.opacity = seg(lt, 0.15, 0.7).toFixed(3)
      kick.style.transform = `translateY(${lerp(16, 0, seg(lt, 0.15, 0.8)).toFixed(2)}px)`
      const sub = document.getElementById('open-sub')
      sub.innerHTML = `${top.name.toUpperCase()} <em>·</em> ${top.team} <em>·</em> ${top.price}`
      sub.style.opacity = seg(lt, 1.85, 0.75).toFixed(3)
      sub.style.transform = `translateY(${lerp(18, 0, seg(lt, 1.85, 0.9)).toFixed(2)}px)`
      const drift = lerp(1.0, 1.045, clamp01(lt / (b.end - b.start)))
      num.style.transform = `scale(${(drift * lerp(1.06, 1, seg(lt, 0.3, 1.1, easeOutQuint))).toFixed(4)})`
      b.node.style.transform = `scale(${drift.toFixed(4)})`
    }
  }

  // -- 2, 8 · kinetic type -------------------------------------------------
  typeBeat(BEATS.type1, t, 0.10)
  typeBeat(BEATS.type2, t, 0.10)

  // -- 3 · the ranking fills in -------------------------------------------
  {
    const b = BEATS.table, lt = local(b, t)
    if (lt !== null) {
      cameraKeys(inner('players'), lt, [
        { t: 0.0, cx: 720, cy: 658, w: 1440 },
        { t: 9.0, cx: 566, cy: 772, w: 1090 },
      ])
      ROWMASKS.forEach((m, i) => {
        m.style.opacity = (1 - seg(lt, 0.55 + i * 0.085, 0.32, easeOutCubic)).toFixed(3)
      })
      chip(b, lt, '#b-table .chip')
    }
  }

  // -- 4 · what goes into the number ---------------------------------------
  {
    const b = BEATS.inputs, lt = local(b, t)
    if (lt !== null) {
      document.querySelectorAll('#b-inputs .in-row').forEach((r, i) => {
        const p = seg(lt, 0.35 + i * 0.42, 0.62, easeOutQuint)
        r.style.opacity = p.toFixed(3)
        r.style.transform = `translateY(${lerp(38, 0, p).toFixed(2)}px)`
        const rule = r.querySelector('.rule')
        rule.style.transform = `scaleX(${seg(lt, 0.35 + i * 0.42, 0.55, easeOutExpo).toFixed(3)})`
        rule.style.transformOrigin = 'left center'
      })
      const sum = document.querySelector('#b-inputs .in-sum')
      const p = seg(lt, 2.60, 0.75, easeOutQuint)
      sum.style.opacity = p.toFixed(3)
      sum.style.transform = `translateY(${lerp(30, 0, p).toFixed(2)}px)`
    }
  }

  // -- 5 · six weeks of fixture difficulty ---------------------------------
  {
    const b = BEATS.fixtures, lt = local(b, t)
    if (lt !== null) {
      cameraKeys(inner('fixtures'), lt, [
        { t: 0.0, cx: 720, cy: 706, w: 1440 },
        { t: 7.6, cx: 615, cy: 800, w: 1180 },
      ])
      const tb = PLATES.fixtures.table
      SWEEP.style.transform = `translateX(${lerp(0, tb.w + 60, seg(lt, 0.15, 2.45, easeInOutCubic)).toFixed(1)}px)`
      chip(b, lt, '#b-fixtures .chip')
    }
  }

  // -- 6 · the captain call ------------------------------------------------
  {
    const b = BEATS.captain, lt = local(b, t)
    if (lt !== null) {
      const pick = PLATES.preview.figures.captains[0].rect
      cameraKeys(inner('preview'), lt, [
        { t: 0.0, cx: 720, cy: 560, w: 1440 },
        { t: 2.6, cx: 660, cy: 566, w: 1300 },
        { t: 7.9, cx: 284, cy: 595, w: 520 },
      ])
      chip(b, lt, '#b-captain .chip')
    }
  }

  // -- 7a · the fifteen ----------------------------------------------------
  {
    const b = BEATS.squad, lt = local(b, t)
    if (lt !== null) {
      cameraKeys(inner('squad'), lt, [
        { t: 0.0, cx: 575, cy: 1036, w: 1150 },
        { t: 6.4, cx: 490, cy: 1024, w: 980 },
      ])
      chip(b, lt, '#b-squad .chip')
      const cur = document.getElementById('cursor')
      const p = seg(lt, 1.15, 1.60, easeInOutCubic)
      const x = lerp(1600, 906, p), y = lerp(930, 688, p)
      cur.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      cur.style.opacity = (seg(lt, 0.95, 0.35) * (1 - seg(lt, 5.1, 0.6))).toFixed(3)
      const ring = cur.querySelector('.ring')
      const rp = clamp01((lt - 2.95) / 0.62)
      ring.style.opacity = (rp > 0 && rp < 1 ? (1 - rp) * 0.95 : 0).toFixed(3)
      ring.style.transform = `scale(${lerp(0.35, 2.6, easeOutCubic(rp)).toFixed(3)})`
    }
  }

  // -- 7b · the season, week by week ---------------------------------------
  {
    const b = BEATS.plan, lt = local(b, t)
    if (lt !== null) {
      cameraKeys(inner('squad2'), lt, [
        { t: 0.0, cx: 662, cy: 420, w: 1060 },
        { t: 4.7, cx: 622, cy: 428, w: 950 },
      ])
      chip(b, lt, '#b-plan .chip')
    }
  }

  // -- 9 · end card --------------------------------------------------------
  {
    const b = BEATS.end, lt = local(b, t)
    if (lt !== null) {
      const wm = document.querySelector('#b-end .wordmark')
      wm.style.transform = `scale(${lerp(1.08, 1, seg(lt, 0.0, 1.5, easeOutQuint)).toFixed(4)})`
      const set = (sel, at) => {
        const el = document.querySelector(sel)
        const p = seg(lt, at, 0.85, easeOutQuint)
        el.style.opacity = p.toFixed(3)
        el.style.transform = `translateY(${lerp(16, 0, p).toFixed(2)}px)`
      }
      set('#b-end .wm-kick', 0.55)
      set('#b-end .wm-url', 1.25)
      set('#b-end .wm-legal', 2.05)
      // A very slow drift so the hold never freezes into a still.
      b.node.style.transform = `scale(${lerp(1, 1.022, clamp01(lt / (b.end - b.start))).toFixed(4)})`
    }
  }
}

/** Words land on a stagger, then the highlight swipes in behind the key phrase. */
function typeBeat(b, t, stagger) {
  const lt = local(b, t)
  if (lt === null) return
  const words = b.node.querySelectorAll('.w')
  words.forEach((w, i) => {
    const p = seg(lt, 0.18 + i * stagger, 0.72, easeOutQuint)
    w.style.opacity = p.toFixed(3)
    w.style.transform = `translateY(${lerp(42, 0, p).toFixed(2)}px)`
    w.style.filter = p < 1 ? `blur(${lerp(9, 0, p).toFixed(2)}px)` : 'none'
  })
  const hl = b.node.querySelector('.hl i')
  if (hl) {
    const at = 0.18 + words.length * stagger + 0.16
    hl.style.transform = `scaleX(${seg(lt, at, 0.62, easeOutExpo).toFixed(3)})`
  }
  const drift = lerp(1.0, 1.03, clamp01(lt / (b.end - b.start)))
  b.node.style.transform = `scale(${drift.toFixed(4)})`
}

/** Caption chips rise in and sit still. */
function chip(b, lt, sel) {
  const c = document.querySelector(sel)
  const p = seg(lt, 0.75, 0.8, easeOutQuint)
  c.style.opacity = (p * (1 - seg(lt, (b.end - b.start) - 0.9, 0.7))).toFixed(3)
  c.style.transform = `translateY(${lerp(26, 0, p).toFixed(2)}px)`
}

// ---------------------------------------------------------------- boot
window.__TOTAL = TOTAL
window.__FPS = FPS
window.__setFrame = setFrame

window.__ready = (async () => {
  PLATES = await (await fetch('/tools/video/plates/plates.json')).json()
  splitWords()
  ROWMASKS = buildRowMasks()
  SWEEP = buildSweep()
  await document.fonts.ready
  await Promise.all([...document.images].map((img) =>
    img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = r })))
  setFrame(0)
  document.documentElement.setAttribute('data-ready', '1')
  return true
})()
