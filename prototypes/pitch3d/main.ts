import { PitchScene, type Variant } from './scene'
import { SQUAD } from './squad'

/* Entry: load the headshots, build the scene, wire the switcher and put a
   real frame-time readout on screen.

   Photos come from one of two places. Served from the repo they are the
   mirrored same-origin files the app already ships (public/img/players); built
   into the single-file bundle they are data URIs on __PHOTOS. Either way they
   are same-origin, which matters because a canvas that has drawn a
   cross-origin image cannot be read back — the same constraint that put the
   mirror in front of the CDN for the share exports. */

declare global {
  interface Window { __PHOTOS?: Record<string, string> }
}

const PHOTO_BASE = '/img/players'

function loadPhotos(): Promise<Map<number, HTMLImageElement>> {
  const inlined = window.__PHOTOS
  const out = new Map<number, HTMLImageElement>()
  return Promise.all(
    SQUAD.map(
      (p) =>
        new Promise<void>((done) => {
          const img = new Image()
          img.onload = () => { out.set(p.code, img); done() }
          // A missing headshot is not an error — the card paints its monogram
          // instead, exactly as the 2D one does.
          img.onerror = () => done()
          img.src = inlined?.[String(p.code)] ?? `${PHOTO_BASE}/${p.code}.webp`
        }),
    ),
  ).then(() => out)
}

const COPY: Record<Variant, { title: string; blurb: string }> = {
  standing: {
    title: 'Standing XI',
    blurb:
      'Cards stand on the grass and turn to face you as the pitch rotates. Nothing is ever foreshortened, so the board stays as readable as the flat one — the depth is in the pitch, not the cards.',
  },
  tabletop: {
    title: 'Tabletop',
    blurb:
      'Cards lie on the grass like magnets on a tactics board. Real perspective and real shadows; the formation is an object you can spin rather than a picture of one.',
  },
  columns: {
    title: 'Value columns',
    blurb:
      'Each card rides a plinth as tall as that player’s projected points. The board becomes a bar chart in the shape of a team — the only one of the three that shows something the flat pitch cannot.',
  },
}

async function boot() {
  const canvas = document.getElementById('stage') as HTMLCanvasElement
  const photos = await loadPhotos()
  document.getElementById('loading')!.remove()

  const scene = new PitchScene(canvas, photos)
  scene.start()

  const title = document.getElementById('v-title')!
  const blurb = document.getElementById('v-blurb')!
  const fps = document.getElementById('fps')!

  const panel = document.querySelector('.panel') as HTMLElement
  // After the blurb has been swapped, not before — the three captions wrap to
  // different heights and the panel is only the right size once the new one
  // has laid out.
  const syncSafeArea = () =>
    requestAnimationFrame(() => scene.setSafeBottomPx(panel.getBoundingClientRect().height))

  const setVariant = (v: Variant) => {
    scene.setVariant(v)
    title.textContent = COPY[v].title
    blurb.textContent = COPY[v].blurb
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-variant]')) {
      b.classList.toggle('on', b.dataset.variant === v)
    }
    syncSafeArea()
  }

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-variant]')) {
    b.addEventListener('click', () => setVariant(b.dataset.variant as Variant))
  }
  setVariant('standing')

  const shadows = document.getElementById('shadows') as HTMLInputElement
  shadows.addEventListener('change', () => scene.setShadows(shadows.checked))
  const spin = document.getElementById('spin') as HTMLInputElement
  spin.addEventListener('change', () => scene.setAutoRotate(spin.checked))
  scene.setAutoRotate(spin.checked)

  setInterval(() => {
    const ms = scene.frameTime()
    if (ms > 0) fps.textContent = `${ms.toFixed(1)} ms · ${Math.round(1000 / ms)} fps`
  }, 400)

  addEventListener('resize', () => { scene.resize(); syncSafeArea() })
  scene.resize()
  syncSafeArea()

  // A hook for the Playwright harness, so a screenshot can be taken from a
  // named angle instead of whatever the camera drifted to.
  ;(window as unknown as Record<string, unknown>).__scene = scene
}

boot()
