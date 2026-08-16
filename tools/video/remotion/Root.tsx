// The motion-graphics layer, and the assembly that joins it to the filmed
// product. render.mjs films the real site; this tops and tails that footage
// with branded cards and dissolves the joins.

import React from 'react'
import {
  AbsoluteFill, Audio, Composition, Img, OffthreadVideo, Sequence,
  interpolate, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion'
import { BrandFonts, BODY, DISPLAY, GOLD, GOLD_2, INK, LOGO, LOGO_BG } from './brand'

const FPS = 30
const W = 1920
const H = 1080

// ---------------------------------------------------------------- cards

/**
 * A gold sheen crossing the mark, echoing the foil sweep the site already runs
 * on the captain card. Clipped to the logo, so it reads as light on metal
 * rather than a band across the frame.
 */
const Sheen: React.FC<{ start: number; size: number }> = ({ start, size }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = spring({ frame: frame - start, fps, config: { damping: 200, mass: 1.6 } })
  return (
    <div style={{
      position: 'absolute', top: 0, bottom: 0, width: size * 0.34,
      left: interpolate(p, [0, 1], [-size * 0.4, size * 1.05]),
      transform: 'skewX(-16deg)', mixBlendMode: 'screen', pointerEvents: 'none',
      background: 'linear-gradient(90deg, transparent, rgba(255,242,205,0.30), transparent)',
    }} />
  )
}

const Lockup: React.FC<{ size: number; opacity: number; scale: number; sheenAt?: number }> =
  ({ size, opacity, scale, sheenAt }) => (
    <div style={{
      position: 'relative', width: size, height: size, overflow: 'hidden',
      opacity, transform: `scale(${scale})`,
    }}>
      <Img src={staticFile(LOGO)} style={{ width: '100%', height: '100%', display: 'block' }} />
      {sheenAt === undefined ? null : (
        // The sheen is masked to fade out before it reaches the edges. Clipped
        // square by overflow alone, it stopped dead at the image boundary and
        // drew the logo's edge against the background — turning a light sweep
        // into a visible rectangle.
        <div style={{
          position: 'absolute', inset: 0, overflow: 'hidden',
          WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 20%, #000 80%, transparent 100%)',
          maskImage: 'linear-gradient(90deg, transparent 0%, #000 20%, #000 80%, transparent 100%)',
        }}>
          <Sheen start={sheenAt} size={size} />
        </div>
      )}
    </div>
  )

export const Intro: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // Settles rather than slides. The mark is the whole card, so the movement has
  // to be small or it reads as a slide transition.
  const rise = spring({ frame, fps, config: { damping: 200 } })

  return (
    <AbsoluteFill style={{ background: LOGO_BG, justifyContent: 'center', alignItems: 'center' }}>
      {/* 840 of 1080 — the mark carries the card, so it should own the frame.
          Safe because motion.mjs hands over a cropped 1280px asset, so this is
          a downscale, not the browser guessing at missing pixels. */}
      <Lockup size={840} opacity={rise} scale={interpolate(rise, [0, 1], [0.94, 1])} sheenAt={16} />
    </AbsoluteFill>
  )
}

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const a = spring({ frame, fps, config: { damping: 200 } })
  const b = spring({ frame: frame - 16, fps, config: { damping: 200 } })

  return (
    <AbsoluteFill style={{ background: LOGO_BG, justifyContent: 'center', alignItems: 'center' }}>
      <Lockup size={620} opacity={a} scale={interpolate(a, [0, 1], [0.95, 1])} sheenAt={20} />
      {/* The lockup already carries the wordmark, so this adds only the call to
          action — repeating the name under it would read as a mistake. */}
      <div style={{
        marginTop: 26, fontFamily: BODY, fontWeight: 800, fontSize: 54, color: '#fff',
        opacity: b, transform: `translateY(${interpolate(b, [0, 1], [16, 0])}px)`,
      }}>
        fplanalyser.co.uk
      </div>
      <div style={{
        marginTop: 14, fontFamily: BODY, fontWeight: 800, fontSize: 23,
        letterSpacing: '0.28em', color: GOLD_2, opacity: b,
      }}>
        FREE · NO SIGNUP
      </div>
    </AbsoluteFill>
  )
}

/** A number that springs up to its value — for a stat sting between shots. */
export const StatCard: React.FC<{ kicker: string; name: string; value: number; suffix: string }> =
  ({ kicker, name, value, suffix }) => {
    const frame = useCurrentFrame()
    const { fps } = useVideoConfig()
    const card = spring({ frame, fps, config: { damping: 200 } })
    const count = spring({ frame: frame - 9, fps, config: { damping: 200, mass: 0.8 } })

    return (
      <AbsoluteFill style={{ background: INK, justifyContent: 'center', alignItems: 'center' }}>
        <div style={{
          width: 980, padding: '52px 64px', borderRadius: 22,
          background: `linear-gradient(160deg, rgba(201,162,39,0.17), rgba(12,11,9,0.92))`,
          border: `1.5px solid ${GOLD}`, boxShadow: '0 30px 90px rgba(0,0,0,0.6)',
          opacity: card, transform: `scale(${interpolate(card, [0, 1], [0.93, 1])})`,
        }}>
          <div style={{
            fontFamily: BODY, fontWeight: 800, fontSize: 22, letterSpacing: '0.3em',
            textTransform: 'uppercase', color: GOLD_2,
          }}>{kicker}</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 88, color: '#fff', marginTop: 10 }}>{name}</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 148, color: GOLD, marginTop: 2 }}>
            {(value * count).toFixed(2)}
            <span style={{ fontFamily: BODY, fontSize: 44, color: GOLD_2 }}> {suffix}</span>
          </div>
        </div>
      </AbsoluteFill>
    )
  }

// ---------------------------------------------------------------- assembly

type Clip = { src: string; durationInFrames: number }
type FilmProps = { clips: Clip[]; dissolve: number; audio: string | null; musicVolume: number }

const INTRO = 70
const OUTRO = 90

/** Where each element starts, given every element overlaps the last by `dissolve`. */
function layout(clips: Clip[], dissolve: number) {
  const items: { from: number; dur: number; clip?: Clip }[] = []
  let at = 0
  items.push({ from: 0, dur: INTRO })
  at = INTRO - dissolve
  for (const clip of clips) {
    items.push({ from: at, dur: clip.durationInFrames, clip })
    at += clip.durationInFrames - dissolve
  }
  items.push({ from: at, dur: OUTRO })
  return { items, total: at + OUTRO }
}

/** Fades in over the first `dissolve` frames; the element beneath shows through. */
const Dissolve: React.FC<{ dissolve: number; first: boolean; children: React.ReactNode }> =
  ({ dissolve, first, children }) => {
    const frame = useCurrentFrame()
    const opacity = first ? 1 : interpolate(frame, [0, dissolve], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    })
    return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
  }

export const Film: React.FC<FilmProps> = ({ clips, dissolve, audio, musicVolume }) => {
  const { items } = layout(clips, dissolve)
  return (
    <AbsoluteFill style={{ background: INK }}>
      {audio ? <Audio src={staticFile(audio)} volume={musicVolume} /> : null}
      {items.map((item, i) => (
        <Sequence key={i} from={item.from} durationInFrames={item.dur}>
          <Dissolve dissolve={dissolve} first={i === 0}>
            {item.clip
              ? <OffthreadVideo src={staticFile(item.clip.src)} />
              : (i === 0 ? <Intro /> : <EndCard />)}
          </Dissolve>
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- root

export const RemotionRoot: React.FC = () => (
  <BrandFonts>
    <Composition id="Intro" component={Intro} durationInFrames={INTRO} fps={FPS} width={W} height={H} />
    <Composition id="EndCard" component={EndCard} durationInFrames={OUTRO} fps={FPS} width={W} height={H} />
    <Composition
      id="StatCard" component={StatCard} durationInFrames={105} fps={FPS} width={W} height={H}
      defaultProps={{ kicker: 'The captain pick', name: 'B.Fernandes', value: 6.45, suffix: 'xP' }}
    />
    <Composition
      id="Film" component={Film} fps={FPS} width={W} height={H}
      durationInFrames={600}
      defaultProps={{ clips: [], dissolve: 12, audio: null, musicVolume: 0.18 } as FilmProps}
      // The film's length is whatever the supplied clips add up to, minus the
      // overlaps, so it is computed rather than declared.
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, layout(props.clips, props.dissolve).total),
      })}
    />
  </BrandFonts>
)
