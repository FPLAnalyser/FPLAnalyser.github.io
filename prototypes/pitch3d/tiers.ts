/* Tier metals, ported from src/components/Pitch.tsx so a 3D card reads as the
   same object as the 2D one. The CSS there is gradients-as-strings; canvas
   needs stops, so each metal is listed as the colours it ramps through and the
   painter builds the gradient. Same hexes, same order. */

export type Tier = 'elite' | 'gold' | 'silver' | 'bronze' | 'graphite' | 'ice'

export const tierOf = (rating: number | null): Tier =>
  rating == null ? 'graphite'
    : rating >= 90 ? 'elite'
      : rating >= 80 ? 'gold'
        : rating >= 70 ? 'silver'
          : rating >= 60 ? 'bronze'
            : 'graphite'

export type Skin = {
  /** Edge ramp. `conic` metals sweep from 210deg like the CSS does. */
  edge: string[]
  conic?: boolean
  /** Card stock, top to bottom. */
  stock: string[]
  /** Ink for the rating figure. */
  num: string
  /** Rim light colour for the mesh, so the metal survives at pitch distance
   *  where a 2px gradient edge is a single pixel. */
  glow?: number
  /** Solid colour for the value column under the card. The card's edge is a
   *  gradient and a gradient does not survive being a 3px-wide cylinder at
   *  distance, so the plinth takes the tier's single most legible colour. It
   *  matters that every tier has one: with only elite lit, a board of ten
   *  columns is one gold bar and nine identical grey ones, which throws away
   *  the ladder the metals exist to show. */
  bar: number
}

export const SKIN: Record<Tier, Skin> = {
  elite: {
    edge: ['#8A6E36', '#F6EDD6', '#FFFBF0', '#D8BE86', '#6E5A2E', '#F6EDD6', '#8A6E36'],
    conic: true,
    stock: ['#1f2023', '#0f1013', '#08090c'],
    num: '#FFFBF0',
    glow: 0xc9a227,
    bar: 0xC9A227,
  },
  gold: {
    edge: ['#5f4d26', '#c9a227', '#ead188', '#50411f'],
    stock: ['#1f2023', '#0f1013', '#08090c'],
    num: '#ead188',
    bar: 0x8A6F2E,
  },
  silver: {
    edge: ['#5C636B', '#C9CFD6', '#e8ecf1', '#4a5057'],
    stock: ['#1a1d21', '#12151a', '#0a0c0e'],
    num: '#e8ecf1',
    bar: 0x6F7883,
  },
  bronze: {
    edge: ['#51351f', '#c8965a', '#e0b385', '#6b4526'],
    stock: ['#1f1b17', '#141110', '#0b0a09'],
    num: '#e0b385',
    bar: 0x7A5432,
  },
  graphite: {
    edge: ['#2f3033', '#55524a', '#2f3033'],
    stock: ['#1c1b19', '#131211', '#0b0b0a'],
    num: '#b9b6ae',
    bar: 0x3A3D42,
  },
  ice: {
    edge: ['#1d4f6b', '#7fd4f5', '#e8fbff', '#4a9fc4', '#153c52', '#7fd4f5', '#1d4f6b'],
    conic: true,
    stock: ['#132430', '#0b171f', '#060d12'],
    num: '#e8fbff',
    glow: 0x7fd4f5,
    bar: 0x4A9FC4,
  },
}

/** Initials for the monogram behind a missing headshot — same rule as the
 *  2D card: "B.Fernandes" -> BF, "Raya" -> RA. */
export function initialsOf(name: string): string {
  const parts = String(name).split(/[\s.\-']+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return String(name).slice(0, 2).toUpperCase()
}
