// The motion-graphics layer, and the assembly that joins it to the filmed
// product. render.mjs films the real site; this tops and tails that footage
// with branded cards and dissolves the joins.

import React from 'react'
import {
  AbsoluteFill, Audio, Composition, OffthreadVideo, Sequence,
  interpolate, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion'
import { BrandFonts, BODY, DISPLAY, GOLD, GOLD_2, INK } from './brand'

const FPS = 30
const W = 1920
const H = 1080

// ---------------------------------------------------------------- cards

export const Intro: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()

  // Springs rather than linear fades. This is most of what separates a title
  // card that reads as produced from one that reads as a slide transition.
  const rise = spring({ frame, fps, config: { damping: 200 } })
  // The rule sits in normal flow between the wordmark and the kicker. Absolutely
  // positioned at a percentage it landed straight through the type, which is
  // invisible in code and obvious in the frame.
  const wipe = interpolate(
    spring({ frame: frame - 7, fps, config: { damping: 200 } }),
    [0, 1], [0, width * 0.3],
  )
  const sub = spring({ frame: frame - 18, fps, config: { damping: 200 } })

  return (
    <AbsoluteFill style={{ background: INK, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{
        fontFamily: DISPLAY, fontSize: 128, color: '#fff', letterSpacing: '-0.03em',
        transform: `translateY(${interpolate(rise, [0, 1], [42, 0])}px)`, opacity: rise,
      }}>
        FPL <span style={{ color: GOLD }}>Analyser</span>
      </div>
      <div style={{
        marginTop: 30, height: 3, width: wipe, borderRadius: 2,
        background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
      }} />
      <div style={{
        marginTop: 26, fontFamily: BODY, fontWeight: 800, fontSize: 26,
        letterSpacing: '0.42em', textTransform: 'uppercase', color: GOLD_2,
        opacity: sub, transform: `translateY(${interpolate(sub, [0, 1], [14, 0])}px)`,
      }}>
        Data · Insight · Points
      </div>
    </AbsoluteFill>
  )
}

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const a = spring({ frame, fps, config: { damping: 200 } })
  const b = spring({ frame: frame - 14, fps, config: { damping: 200 } })

  return (
    <AbsoluteFill style={{ background: INK, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{
        fontFamily: DISPLAY, fontSize: 104, color: '#fff', letterSpacing: '-0.03em',
        opacity: a, transform: `translateY(${interpolate(a, [0, 1], [30, 0])}px)`,
      }}>
        FPL <span style={{ color: GOLD }}>Analyser</span>
      </div>
      <div style={{
        marginTop: 30, fontFamily: BODY, fontWeight: 800, fontSize: 52, color: '#fff', opacity: b,
      }}>
        fplanalyser.co.uk
      </div>
      <div style={{
        marginTop: 14, fontFamily: BODY, fontWeight: 800, fontSize: 24,
        letterSpacing: '0.2em', color: 'rgba(255,255,255,0.62)', opacity: b,
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
