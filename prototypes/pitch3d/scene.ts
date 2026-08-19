import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { paintCard, CARD_WORLD_W, CARD_WORLD_H } from './card'
import { paintPitch, PITCH_TEX_W, PITCH_TEX_L } from './pitch'
import { pickXI, PITCH_W, PITCH_L, type Slot } from './squad'
import { SKIN, tierOf } from './tiers'

export type Variant = 'standing' | 'tabletop' | 'columns'

/* ── Three ideas, one scene ───────────────────────────────────────────────
   standing  Cards stand upright on the grass and turn to face you as the
             pitch rotates underneath. Nothing is ever foreshortened, so the
             board stays exactly as legible as the 2D one and the only thing
             3D adds is that you can look along the formation.
   tabletop  Cards lie on the grass like magnets on a tactics board. Real
             perspective, real shadows; a formation you can spin.
   columns   Each card rides a plinth as tall as the player's projected
             points. The board becomes a bar chart in the shape of a team —
             the one variant that shows something the 2D pitch cannot.
   ─────────────────────────────────────────────────────────────────────── */

const EASE = (t: number) => 1 - Math.pow(1 - t, 3)

/** Below this the viewport is treated as portrait and the board is played
 *  end-on; above it, side-on. 1.2 rather than 1.0 so a nearly-square window
 *  does not flip back and forth as it is dragged. */
const WIDE = 1.2

type Target = { pos: THREE.Vector3; rotX: number; plinth: number }

type CardRig = {
  group: THREE.Group
  card: THREE.Mesh
  plinth: THREE.Mesh
  shadow: THREE.Mesh
  slot: Slot
  from: Target
  to: Target
}

/** Where each variant looks from, and how tightly.

    A DIRECTION and a padding factor, not a position. The first pass hard-coded
    three camera positions, tuned by eye against a 1440x900 screenshot, and on
    a 393-wide phone the same numbers put half the XI outside the frame — the
    horizontal field of view is a third of the desktop one at the same
    distance. So the distance is solved from the content instead: fit the
    squad's bounding sphere to whichever of the two fields of view is narrower.

    Elevation is the other thing measured rather than guessed. Standing cards
    seen from 23 degrees hid the row behind them whatever the spacing; 32 is
    where a four-man midfield stops covering the back four. */
const SHOTS: Record<Variant | 'tabletopWide', { dir: THREE.Vector3; pad: number }> = {
  // Behind our own goal, looking up the pitch — a manager's view of a team
  // sheet, high enough that the rows separate.
  standing: { dir: new THREE.Vector3(0, 0.62, 1).normalize(), pad: 1.16 },
  // Almost overhead: flat cards are only legible from near plan view.
  tabletop: { dir: new THREE.Vector3(0, 1.15, 0.66).normalize(), pad: 1.1 },
  // The same shot, turned a quarter. A pitch is portrait and a laptop is
  // landscape, so viewed from behind the goal a near-overhead tabletop leaves
  // a third of the window empty down each side. Looking along the touchline
  // instead lays the 100m axis across the 1440px one.
  tabletopWide: { dir: new THREE.Vector3(1.15, 1.15, 0).normalize(), pad: 1.1 },
  // Off to one side and LOW. A bar chart is read by comparing heights, and
  // heights only compare when the bars are seen from near their own level —
  // from above, the tallest column just looks like the nearest one.
  columns: { dir: new THREE.Vector3(0.62, 0.42, 0.9).normalize(), pad: 1.22 },
}

/** Plinth height for a projected-points figure. Subtracting a floor rather
 *  than scaling from zero is deliberate: every starter is somewhere between
 *  3.5 and 6.5 xP, and a column that starts at zero makes them all look the
 *  same. The floor is the point of the chart. */
const columnHeight = (xp: number) => Math.max(1.5, (xp - 2.6) * 5.4)

/** Whole-xP rings. Four of them: every starter in this squad falls between
 *  4.4 and 6.5, so 4/5/6 brackets the data and 7 gives the tallest bar a
 *  ceiling to stop short of rather than an open top. */
const TICKS = [4, 5, 6, 7]

function tickLabel(text: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 256
  cv.height = 128
  const c = cv.getContext('2d')!
  c.font = '700 56px system-ui, -apple-system, sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = 'rgba(159,216,255,.85)'
  c.fillText(text, 128, 66)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class PitchScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private rigs: CardRig[] = []
  private variant: Variant = 'standing'
  private tween = 1
  private camFrom = new THREE.Vector3()
  private camTo = new THREE.Vector3()
  private tgtFrom = new THREE.Vector3()
  private tgtTo = new THREE.Vector3()
  private camTween = 1
  private sun: THREE.DirectionalLight
  private frames: number[] = []
  private raf = 0
  private scale!: THREE.Group
  private tickLabels: { sprite: THREE.Sprite; side: number }[] = []
  /** Bottom of the usable frame in NDC. The caption panel is a DOM element
   *  over the canvas and its height depends on how the blurb wraps, which on a
   *  phone is four lines rather than three — so it is measured and pushed in
   *  rather than guessed at. */
  private safeBottom = -0.5

  constructor(private canvas: HTMLCanvasElement, private photos: Map<number, HTMLImageElement>) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    // Cap at 2. A modern phone reports 3, which is 2.25x the pixels of 2 for
    // no visible gain on a card this size — and it is the single biggest lever
    // on frame time in this whole scene.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    // PCFSoft was deprecated in r185; PCF is what it falls back to anyway.
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene.background = new THREE.Color('#080a0d')
    this.scene.fog = new THREE.Fog('#0a141a', 170, 330)

    this.camera = new THREE.PerspectiveCamera(38, canvas.clientWidth / canvas.clientHeight, 0.5, 600)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.07
    this.controls.minDistance = 40
    this.controls.maxDistance = 210
    // Never below the grass: under the pitch there is nothing to see and the
    // markings vanish, which reads as a broken page rather than a camera.
    this.controls.maxPolarAngle = Math.PI * 0.47
    this.controls.enablePan = false

    this.scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x0d2415, 1.15))
    this.sun = new THREE.DirectionalLight(0xffffff, 1.9)
    this.sun.position.set(-48, 96, 54)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    const cam = this.sun.shadow.camera
    cam.left = -78; cam.right = 78; cam.top = 92; cam.bottom = -92; cam.far = 260
    this.scene.add(this.sun)

    this.buildSky()
    this.buildGround()
    this.buildGoals()
    this.buildCards()
    this.buildScale()
    this.setVariant('standing', true)
  }

  /** A gradient dome instead of a flat clear colour.

   *  Two thirds of the first screenshot was dead black above the halfway line,
   *  which made a lit pitch look like it was floating in a void. This is the
   *  cheapest possible fix — one sphere, one 2x256 texture, no lighting — and
   *  it gives the scene a horizon for the pitch to meet. */
  private buildSky() {
    const cv = document.createElement('canvas')
    cv.width = 2
    cv.height = 256
    const c = cv.getContext('2d')!
    const g = c.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, '#05070a')
    g.addColorStop(0.55, '#0b1119')
    g.addColorStop(0.82, '#16303a')
    g.addColorStop(1, '#0a1a1c')
    c.fillStyle = g
    c.fillRect(0, 0, 2, 256)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(300, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
    )
    this.scene.add(dome)
  }

  private buildGround() {
    const tex = new THREE.CanvasTexture(paintPitch())
    tex.colorSpace = THREE.SRGBColorSpace
    // Anisotropy is what keeps the mown stripes and the paint from turning to
    // mush where the pitch runs away from the camera — a ground plane at a
    // grazing angle is the textbook case for it, and it is nearly free.
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(PITCH_TEX_W, PITCH_TEX_L),
      new THREE.MeshLambertMaterial({ map: tex }),
    )
    grass.rotation.x = -Math.PI / 2
    grass.receiveShadow = true
    this.scene.add(grass)

    // A dark apron under everything so the pitch does not float on the fog.
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(340, 340),
      new THREE.MeshBasicMaterial({ color: 0x0a0d10 }),
    )
    apron.rotation.x = -Math.PI / 2
    apron.position.y = -0.06
    this.scene.add(apron)
  }

  private buildGoals() {
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f5f8 })
    const post = new THREE.CylinderGeometry(0.32, 0.32, 2.44, 8)
    for (const end of [-1, 1] as const) {
      const g = new THREE.Group()
      for (const side of [-1, 1] as const) {
        const p = new THREE.Mesh(post, white)
        p.position.set((7.32 / 2) * side, 1.22, 0)
        p.castShadow = true
        g.add(p)
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 7.32 + 0.64, 8), white)
      bar.rotation.z = Math.PI / 2
      bar.position.y = 2.44
      bar.castShadow = true
      g.add(bar)
      // The net, as a single translucent plane leaning back off the bar. A
      // real net is a grid texture; at this distance it is four pixels of
      // grey and this is honest about being a prototype.
      const net = new THREE.Mesh(
        new THREE.PlaneGeometry(7.32, 2.9),
        new THREE.MeshBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.14, side: THREE.DoubleSide }),
      )
      net.position.set(0, 1.2, -1.4 * end)
      net.rotation.x = (Math.PI / 2 - 1.1) * -end
      g.add(net)
      g.position.z = (PITCH_L / 2) * end
      this.scene.add(g)
    }
  }

  private buildCards() {
    const { xi } = pickXI()
    const cardGeo = new THREE.PlaneGeometry(CARD_WORLD_W, CARD_WORLD_H)
    const shadowGeo = new THREE.CircleGeometry(CARD_WORLD_W * 0.42, 24)

    for (const slot of xi) {
      const tex = new THREE.CanvasTexture(
        paintCard(slot.player, this.photos.get(slot.player.code) ?? null, {
          armband: slot.armband ?? null,
          strap: `${slot.player.xp.toFixed(2)} xP`,
        }),
      )
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())

      // Basic, not Lambert. The tier metal is painted INTO the texture, and
      // lighting it a second time means a card in the sun and a card in shade
      // read as two different tiers — which is the one thing the metal is
      // there to stop.
      const card = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true }))
      // YXZ, so the yaw is about the WORLD vertical rather than about the
      // card's own axis after it has been laid flat. In the default XYZ order
      // a tabletop card given a yaw rolls on the grass instead of spinning on
      // it.
      card.rotation.order = 'YXZ'
      card.castShadow = true

      const skin = SKIN[tierOf(slot.player.rating)]
      // Thin. At a third of the card's width these read as silos rather than
      // bars, and a fat column hides the one behind it — the same occlusion
      // problem the rows have, in the other axis.
      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(CARD_WORLD_W * 0.14, CARD_WORLD_W * 0.17, 1, 18),
        new THREE.MeshLambertMaterial({
          color: skin.bar,
          emissive: new THREE.Color(skin.bar),
          emissiveIntensity: 0.22,
        }),
      )
      plinth.castShadow = true
      plinth.visible = false

      const shadow = new THREE.Mesh(
        shadowGeo,
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24 }),
      )
      shadow.rotation.x = -Math.PI / 2
      shadow.position.y = 0.05

      const group = new THREE.Group()
      group.add(card, plinth, shadow)
      group.position.set(slot.x, 0, slot.z)
      this.scene.add(group)

      const t: Target = { pos: new THREE.Vector3(slot.x, 0, slot.z), rotX: 0, plinth: 0 }
      this.rigs.push({ group, card, plinth, shadow, slot, from: { ...t, pos: t.pos.clone() }, to: t })
    }
  }

  /** Reference rings for the value columns, at whole xP values.

   *  This is the fix for the flaw the first render made obvious: in
   *  perspective you cannot compare the heights of bars standing at different
   *  distances. A near 4.6 looked taller than a far 6.4, which makes the chart
   *  not just useless but actively misleading — the exact failure a 3D bar
   *  chart is notorious for.
   *
   *  A ring at each whole xP, spanning the pitch, gives every column a local
   *  datum: you stop comparing bar against bar and start reading each one off
   *  the ring it passes, which perspective does not distort. Labelled at both
   *  ends so one is always facing you as the board turns. */
  private buildScale() {
    const g = new THREE.Group()
    g.visible = false
    const w = PITCH_W / 2 + 2
    const l = PITCH_L / 2 + 2

    for (const xp of TICKS) {
      const y = columnHeight(xp)
      const pts = [
        new THREE.Vector3(-w, y, -l), new THREE.Vector3(w, y, -l),
        new THREE.Vector3(w, y, l), new THREE.Vector3(-w, y, l),
        new THREE.Vector3(-w, y, -l),
      ]
      const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.2 }),
      )
      g.add(ring)

      // One label on each touchline, level with the halfway line — OUTSIDE the
      // pitch, so whichever way the board is turned there is a readable one
      // and neither ever sits on top of a card. The first pass put both on the
      // same side at two different depths and the far one projected straight
      // into the middle of the board, over the midfield.
      for (const side of [-1, 1] as const) {
        // sizeAttenuation OFF: a world-scaled sprite is a chart label that
        // grows as it comes towards you, and the near end of the scale ended
        // up three times the size of the far end of the SAME scale. Axis
        // labels are screen furniture; they hold one size.
        const label = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: tickLabel(`${xp.toFixed(1)} xP`), transparent: true, sizeAttenuation: false }),
        )
        label.scale.set(0.085, 0.0425, 1)
        label.position.set((w + 8) * side, y, 0)
        g.add(label)
        this.tickLabels.push({ sprite: label, side })
      }
    }
    this.scale = g
    this.scene.add(g)
  }

  private targetFor(v: Variant, slot: Slot): Target {
    if (v === 'tabletop') {
      // Flat on the grass, lifted a hair so it does not z-fight the paint.
      return { pos: new THREE.Vector3(slot.x, 0.12, slot.z), rotX: -Math.PI / 2, plinth: 0 }
    }
    if (v === 'columns') {
      const h = columnHeight(slot.player.xp)
      return { pos: new THREE.Vector3(slot.x, h + CARD_WORLD_H / 2, slot.z), rotX: 0, plinth: h }
    }
    // standing: on the turf, leaning back a touch so it reads as a figure
    // rather than a sheet of paper.
    return { pos: new THREE.Vector3(slot.x, CARD_WORLD_H / 2 + 0.2, slot.z), rotX: 0.06, plinth: 0 }
  }

  /** Every corner of every card, at the given variant's layout.
   *
   *  A bounding SPHERE was the first attempt and it zoomed miles out: an XI is
   *  70m deep, 54m wide and 10m tall, and the sphere that contains that is
   *  mostly empty air above and below the pitch. Fitting the actual corners
   *  costs 44 points of projection per frame-fit and frames it properly.
   *
   *  Which way the corners lie depends on the variant, because a standing card
   *  is a billboard — its width always runs along the camera's right — while a
   *  tabletop card is pinned to the grass and its height runs down the pitch. */
  /** Which of SHOTS applies, given the variant and the current aspect. */
  private shotKey(v: Variant): Variant | 'tabletopWide' {
    return v === 'tabletop' && this.camera.aspect > WIDE ? 'tabletopWide' : v
  }

  private corners(v: Variant): THREE.Vector3[] {
    const diag = Math.hypot(CARD_WORLD_W, CARD_WORLD_H) / 2
    const hw = v === 'tabletop' ? diag : CARD_WORLD_W / 2
    const hh = v === 'tabletop' ? diag : CARD_WORLD_H / 2
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    if (v === 'tabletop') {
      // A tabletop card spins on the grass to keep facing the viewer, so its
      // footprint is not axis-aligned at any particular moment. Bound it with
      // the diagonal in both ground axes — the corners are then correct for
      // every yaw instead of for one.
      right.set(1, 0, 0)
      up.set(0, 0, 1)
    } else {
      right.copy(SHOTS[this.shotKey(v)].dir).cross(new THREE.Vector3(0, 1, 0)).normalize()
      up.set(0, 1, 0)
    }
    const out: THREE.Vector3[] = []
    for (const rig of this.rigs) {
      const c = this.targetFor(v, rig.slot).pos
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          out.push(c.clone().addScaledVector(right, sx * hw).addScaledVector(up, sy * hh))
        }
      }
    }
    if (v === 'columns') {
      // The foot of every column, so a value chart never has its bars sliced
      // off at the bottom, and the anchor of every scale label, so the axis
      // is not cropped off the side of the frame.
      for (const rig of this.rigs) out.push(new THREE.Vector3(rig.slot.x, 0, rig.slot.z))
      for (const xp of TICKS) {
        for (const side of [-1, 1] as const) out.push(new THREE.Vector3((PITCH_W / 2 + 10) * side, columnHeight(xp), 0))
      }
    }
    return out
  }

  /** Solve a camera position and target that put the whole XI inside the part
   *  of the screen the caption panel is not covering.
   *
   *  Iterative rather than closed-form: place the camera, project the corners,
   *  measure how far outside the usable box they land, move, repeat. Three
   *  passes is enough to converge to under a pixel, and it is aspect-correct by
   *  construction — the same code frames a 1440x900 desktop and a 393-wide
   *  phone without a breakpoint, which the hand-tuned positions could not.
   *
   *  BOX is in normalised device coordinates, and it is not centred: the panel
   *  eats the bottom fifth of the viewport, so the usable area's middle is
   *  above the screen's middle and the content has to be aimed there. */
  private frame(v: Variant): { pos: THREE.Vector3; target: THREE.Vector3 } {
    // Sides pull in for the value columns because its scale labels are drawn
    // at a fixed SCREEN size — their world anchors are inside the frame while
    // the glyphs themselves hang another 0.17 of NDC further out, which on a
    // 393px phone is most of a label off the edge. This is the margin that
    // costs, in the one variant that has them.
    const sx = v === 'columns' ? 0.72 : 0.9
    const BOX = { x0: -sx, x1: sx, y0: this.safeBottom, y1: 0.9 }
    const pts = this.corners(v)
    const centre = pts
      .reduce((a, b) => a.add(b), new THREE.Vector3())
      .divideScalar(Math.max(pts.length, 1))

    const cam = this.camera.clone() as THREE.PerspectiveCamera
    cam.aspect = this.camera.aspect
    const dir = SHOTS[this.shotKey(v)].dir
    let target = centre.clone()
    let dist = pts.reduce((m, p) => Math.max(m, p.distanceTo(centre)), 1) * 2.2

    for (let pass = 0; pass < 3; pass++) {
      cam.position.copy(target).addScaledVector(dir, dist)
      cam.lookAt(target)
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld(true)

      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (const p of pts) {
        const n = p.clone().project(cam)
        x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x)
        y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y)
      }
      // Scale to fit, with the variant's padding as breathing room.
      const grow = Math.max((x1 - x0) / (BOX.x1 - BOX.x0), (y1 - y0) / (BOX.y1 - BOX.y0))
      dist *= grow * SHOTS[this.shotKey(v)].pad

      // Re-aim: slide the target along the camera's own right and up axes by
      // however far the content's centre is from the usable box's centre. The
      // NDC error is converted to world units through the frustum height at
      // this distance, which is why this has to happen after the rescale.
      const ex = (x0 + x1) / 2 - (BOX.x0 + BOX.x1) / 2
      const ey = (y0 + y1) / 2 - (BOX.y0 + BOX.y1) / 2
      const hHalf = Math.tan((cam.fov * Math.PI) / 360) * dist
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
      target.addScaledVector(right, ex * hHalf * cam.aspect).addScaledVector(up, ey * hHalf)
    }

    return { pos: target.clone().addScaledVector(dir, dist), target }
  }

  /** Tell the scene how much of the bottom of the canvas is covered, in
   *  pixels, and re-frame around what is left. */
  setSafeBottomPx(px: number) {
    const h = Math.max(this.canvas.clientHeight, 1)
    this.safeBottom = Math.min(0.6, -1 + (px / h) * 2 + 0.06)
    this.reframe()
  }

  /** Re-fit at the current variant, keeping the user's angle. */
  private reframe() {
    const shot = this.frame(this.variant)
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.controls.target.copy(shot.target)
    this.camera.position.copy(shot.target).addScaledVector(dir, shot.pos.distanceTo(shot.target))
  }

  setVariant(v: Variant, instant = false) {
    this.variant = v
    this.scale.visible = v === 'columns'
    for (const rig of this.rigs) {
      rig.from = {
        pos: rig.group.position.clone().setY(rig.card.position.y + rig.group.position.y),
        rotX: rig.card.rotation.x,
        plinth: rig.plinth.scale.y,
      }
      rig.to = this.targetFor(v, rig.slot)
      // Cards lying ON the grass need no contact shadow — the disc is a cue
      // for "this thing is above the ground", and under a flat card it just
      // pokes out from behind one edge and reads as a smudge.
      rig.shadow.visible = v !== 'tabletop'
    }
    this.tween = instant ? 1 : 0
    const shot = this.frame(v)
    this.camFrom.copy(this.camera.position)
    this.tgtFrom.copy(this.controls.target)
    this.camTo.copy(shot.pos)
    this.tgtTo.copy(shot.target)
    this.camTween = instant ? 1 : 0
    if (instant) {
      this.camera.position.copy(shot.pos)
      this.controls.target.copy(shot.target)
      this.applyTween(1)
    }
  }

  private applyTween(t: number) {
    for (const rig of this.rigs) {
      const y = THREE.MathUtils.lerp(rig.from.pos.y, rig.to.pos.y, t)
      rig.card.position.y = y
      rig.card.rotation.x = THREE.MathUtils.lerp(rig.from.rotX, rig.to.rotX, t)

      const h = THREE.MathUtils.lerp(rig.from.plinth, rig.to.plinth, t)
      rig.plinth.visible = h > 0.02
      rig.plinth.scale.y = Math.max(h, 0.001)
      rig.plinth.position.y = h / 2

      // The contact shadow tightens as the card comes down and fades as it
      // rises — the cue that tells you a thing is off the ground.
      const lift = Math.max(0, y - 1)
      const s = THREE.MathUtils.clamp(1 - lift / 34, 0.35, 1)
      rig.shadow.scale.setScalar(1 / Math.max(s, 0.35))
      ;(rig.shadow.material as THREE.MeshBasicMaterial).opacity = 0.26 * s
    }
  }

  /** Yaw-only billboard: cards turn to face the camera but stay upright, so
   *  the board never leans. Only the standing variant wants this — a tabletop
   *  card that swivelled would look like it was sliding around the grass. */
  /** Only the near side of the scale is drawn.
   *
   *  Both touchlines carry the same four labels so one is always facing you,
   *  but the far set is behind ten cards and shows as fragments poking out
   *  between them — a stray "P" beside a player's head reads as a rendering
   *  fault, not an axis. Hide whichever side the camera is not on. */
  private updateScale() {
    if (!this.scale.visible) return
    const camSide = Math.sign(this.camera.position.x - this.controls.target.x) || 1
    for (const t of this.tickLabels) t.sprite.visible = t.side === camSide
  }

  private billboard() {
    const a = Math.atan2(
      this.camera.position.x - this.controls.target.x,
      this.camera.position.z - this.controls.target.z,
    )
    // Every variant gets the same yaw, tabletop included. A flat card that
    // held still while the board turned ended up reading sideways or upside
    // down half the way round the orbit; turning with the camera means it is
    // legible at every angle, which is exactly what a magnet on a tactics
    // board does when you spin the board round to show someone.
    for (const rig of this.rigs) rig.card.rotation.y = a
  }

  resize() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
    // Re-fit, but only the DISTANCE — rotating the user's view back to the
    // default on a phone-rotation would be obnoxious. Keep their angle, move
    // along it until the squad fits the new aspect again.
    this.reframe()
  }

  setShadows(on: boolean) {
    this.renderer.shadowMap.enabled = on
    this.sun.castShadow = on
    for (const rig of this.rigs) {
      rig.card.castShadow = on
      rig.plinth.castShadow = on
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (!m) return
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true
    })
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on
    this.controls.autoRotateSpeed = 0.55
  }

  /** Rolling mean frame time over the last 120 frames, in ms. Reported rather
   *  than inferred — the whole point of building this was to have a number. */
  frameTime(): number {
    if (this.frames.length < 8) return 0
    return this.frames.reduce((a, b) => a + b, 0) / this.frames.length
  }

  start(onFrame?: (ms: number) => void) {
    let last = performance.now()
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = now - last
      last = now

      if (this.tween < 1) {
        this.tween = Math.min(1, this.tween + dt / 700)
        this.applyTween(EASE(this.tween))
      }
      if (this.camTween < 1) {
        this.camTween = Math.min(1, this.camTween + dt / 700)
        const e = EASE(this.camTween)
        this.camera.position.lerpVectors(this.camFrom, this.camTo, e)
        this.controls.target.lerpVectors(this.tgtFrom, this.tgtTo, e)
      }

      this.billboard()
      this.updateScale()
      this.controls.update()
      this.renderer.render(this.scene, this.camera)

      this.frames.push(dt)
      if (this.frames.length > 120) this.frames.shift()
      onFrame?.(dt)
    }
    loop()
  }

  stop() {
    cancelAnimationFrame(this.raf)
  }
}
