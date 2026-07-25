import { useState, type ReactNode } from 'react'
import { TeamBadge } from './badges'
import { clubInfo } from '../lib/clubs'
import { teamFullNames } from '../lib/util'

// Section hero banners: every section opens with the same photo as its home
// tile (tile → page continuity). Photos live in public/home/<key>.jpg with the
// branded gradient fallback behind; the stadium variant (team pages) loads
// public/stadiums/<TEAM>.jpg over a club-tinted floodlit bowl.

const IMG_BASE = import.meta.env.BASE_URL

function BannerImg({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onLoad={() => setLoaded(true)}
      onError={(e) => { e.currentTarget.style.display = 'none' }}
      className={`hw-img ${loaded ? 'is-on' : ''}`}
    />
  )
}

export function SectionBanner({
  imgKey,
  title,
  subtitle,
  tools,
}: {
  /** Photo key — matches the home tile: players | teams | fixtures | scouting | squad | myteam */
  imgKey: string
  title: string
  subtitle?: string
  tools?: ReactNode
}) {
  return (
    <header className="sb">
      <div className={`sb-photo hw-${imgKey}`}>
        <BannerImg src={`${IMG_BASE}home/${imgKey}.jpg`} />
      </div>
      <div className="hw-grain" />
      <div className="sb-inner">
        <div className="min-w-0">
          <div className="sb-crumbs">Home <span>/</span> {title}</div>
          <h1 className="sb-title font-cond">{title}</h1>
          {subtitle && <p className="sb-sub">{subtitle}</p>}
        </div>
        {tools && <div className="sb-tools">{tools}</div>}
      </div>
    </header>
  )
}

export function StadiumBanner({
  team,
  stats,
}: {
  team: string
  /** Marquee stats shown as chips (e.g. Attack / Defence / Set pieces). */
  stats?: { label: string; value: string }[]
}) {
  const info = clubInfo(team)
  const name = teamFullNames[team] || team
  // Club-tinted ambient glow; alpha keeps the gold accent as the anchor.
  const glow = info ? `${info.color}66` : undefined
  return (
    <header className="sb sb-stadium" style={glow ? ({ ['--club-glow' as string]: glow } as React.CSSProperties) : undefined}>
      <div className="sb-photo">
        <span className="sb-clubglow" />
        <span className="sb-bowl" />
        <span className="sb-pitchline" />
        <BannerImg src={`${IMG_BASE}stadiums/${team}.jpg`} />
      </div>
      <div className="hw-grain" />
      <div className="sb-inner">
        <div className="min-w-0">
          <div className="sb-crumbs">Home <span>/</span> Teams <span>/</span> {name}</div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-full border border-white/40 bg-black/40">
              <TeamBadge team={team} size={26} />
            </span>
            <h1 className="sb-title font-cond">{name}</h1>
          </div>
          {info && (
            <p className="sb-sub">
              {info.stadium}
            </p>
          )}
        </div>
        {stats && stats.length > 0 && (
          <div className="sb-tools">
            {stats.map((s) => (
              <div key={s.label} className="sb-statchip">
                <div className="metallic-num font-num text-lg font-extrabold tabular-nums">{s.value}</div>
                <div className="text-[9px] font-bold tracking-[0.12em] text-white/60 uppercase">{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  )
}
