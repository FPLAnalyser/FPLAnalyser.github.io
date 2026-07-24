import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageShell } from '../components/PageShell'
import { PageSkeleton } from '../components/Skeleton'
import { PlayerPhoto } from '../components/PlayerPhoto'
import { RadialGauge, type Tone } from '../components/viz'
import { StarRating } from '../components/StarRating'
import { TeamBadge } from '../components/badges'
import { Icon, type IconName } from '../components/Icon'
import { useCore } from '../lib/useData'
import { useSeason } from '../lib/season'
import { num, str } from '../lib/rows'
import { teamFullNames, playerHref } from '../lib/util'
import { buildLeagueStories } from '../lib/insights/narrative'
import type { CoreData, RatingRow, Row } from '../lib/types'

const TONE_TEXT: Record<string, string> = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', info: 'text-info', hot: 'text-hot', cold: 'text-cold' }

function PhotoByCode({ code, element, size = 40 }: { code: number | null; element?: number | null; size?: number }) {
  // PL headshots are portrait; match the box aspect so the whole head-and-
  // shoulders fits instead of cropping a zoomed-in face.
  const h = Math.round(size * 1.27)
  return (
    <PlayerPhoto
      code={code}
      element={element}
      className="shrink-0 rounded-md object-cover object-top"
      style={{ width: size, height: h }}
      placeholder={<div className="shrink-0 rounded-md bg-surface-3" style={{ width: size, height: h }} />}
    />
  )
}

interface DashItem { rank: number; name: string; code: number | null; element?: number | null; pos: string; team: string; value: ReactNode }
function DashCard({ title, icon, items, onPlayer }: { title: string; icon: ReactNode; items: DashItem[]; onPlayer: (name: string, code?: number | null) => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1/60 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">{icon}{title}</div>
      <div className="flex flex-col">
        {items.map((it) => (
          <button key={it.rank} onClick={() => onPlayer(it.name, it.code)} className="flex items-center gap-3 border-b border-line py-2 text-left last:border-0 transition-colors hover:bg-surface-2/50">
            <span className="w-6 font-num text-xs text-ink-3 tabular-nums">#{it.rank}</span>
            <PhotoByCode code={it.code} element={it.element} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{it.name}</div>
              <div className="flex items-center gap-1 text-xs text-ink-2">{it.pos} · <TeamBadge team={it.team} size={11} />{teamFullNames[it.team] || it.team}</div>
            </div>
            <span className="font-num text-sm tabular-nums text-ink-2">{it.value}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SectionHeader({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 mb-3 text-sm font-semibold tracking-wide text-ink-2 uppercase first:mt-0">{children}</h2>
}

function Hero() {
  const { info } = useSeason()
  const preseason = Boolean(info?.provisional)
  const seasonLabel = info?.label ?? '2026/27'
  const ratingsFrom = info?.ratings_season ? info.ratings_season.replace('-', '/') : null
  return (
    <section className="mb-8">
      <p className="mb-4 text-[11px] font-semibold tracking-[0.28em] text-accent uppercase">Data. Insight. Points.</p>
      <h1 className="max-w-3xl text-3xl leading-[1.08] font-extrabold tracking-[-0.02em] text-ink md:text-5xl">
        Turn Premier League data into FPL points.
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-2 md:text-lg">
        FPL Analyser rates every player on the numbers that actually predict returns — expected goals, minutes, form and
        fixtures — then turns them into a plain-language verdict and transfer calls for <em>your</em> team.
      </p>

      {preseason && (
        <div className="mt-5 max-w-2xl rounded-xl border border-accent/25 bg-accent-soft/40 p-4">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-accent uppercase">
            <Icon name="star" size={13} /> Welcome to the {seasonLabel} season
          </div>
          <p className="text-sm leading-relaxed text-ink-2">
            New season, fresh squads. Every {seasonLabel} player, price and fixture is loaded and ready to plan around.
            {ratingsFrom ? <> Player and team ratings carry over from <strong>{ratingsFrom}</strong> until GW1 is played, then they switch to live {seasonLabel} form.</> : null}
          </p>
        </div>
      )}
    </section>
  )
}

// Base path for site assets (relative build → GitHub Pages sub-path safe).
const IMG_BASE = import.meta.env.BASE_URL

interface HomeWin { key: string; to: string; kicker: string; title: string; desc: string; stat: string; card: string; ghost?: { text: string; style: CSSProperties } }
const WINDOWS: HomeWin[] = [
  { key: 'players', to: '/players', kicker: 'Explore', title: 'Players', desc: 'Every player rated 0–100 — form, value, fixtures and the editorial player hero.', stat: '600+ rated', card: 'hw-c6 hw-tall',
    ghost: { text: '8', style: { right: '4%', bottom: '-4%', fontSize: 'clamp(150px,20vw,240px)' } } },
  { key: 'teams', to: '/teams', kicker: 'Explore', title: 'Teams', desc: 'Attack, defence and set-piece ratings for all 20 clubs, with matchup previews.', stat: '20 clubs', card: 'hw-c6 hw-tall',
    ghost: { text: 'AFC', style: { left: '5%', bottom: '2%', fontSize: 'clamp(90px,11vw,140px)', WebkitTextStroke: '2px rgba(255,255,255,.10)' } } },
  { key: 'fixtures', to: '/fixtures', kicker: 'Plan', title: 'Fixtures', desc: 'Our own fixture rating and rotation planner.', stat: 'Next 6 GWs', card: 'hw-c3 hw-med' },
  { key: 'scouting', to: '/scout', kicker: 'Discover', title: 'Scouting', desc: 'Filter the market for your next differential.', stat: 'Find gems', card: 'hw-c3 hw-med' },
  { key: 'squad', to: '/squad', kicker: 'Build', title: 'Squad Builder', desc: 'Draft an XI and plan the season week by week.', stat: '£100.0m', card: 'hw-c3 hw-med' },
  { key: 'myteam', to: '/loadteam', kicker: 'Track', title: 'My Team', desc: 'Link your side for a live rated breakdown.', stat: 'Live GW1', card: 'hw-c3 hw-med',
    ghost: { text: '★', style: { right: '6%', top: '8%', fontSize: 'clamp(80px,10vw,120px)', WebkitTextStroke: '2px color-mix(in srgb, var(--accent) 18%, transparent)' } } },
  { key: 'compare', to: '/compare', kicker: 'Compare', title: 'Compare', desc: 'Two players, side by side — every metric head-to-head.', stat: 'Head-to-head', card: 'hw-c12 hw-wide',
    ghost: { text: 'VS', style: { right: '6%', top: '50%', transform: 'translateY(-50%)', fontSize: 'clamp(64px,9vw,116px)', WebkitTextStroke: '2px rgba(255,255,255,.10)' } } },
]

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-1">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function WindowCard({ w }: { w: HomeWin }) {
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState(false)
  return (
    <button type="button" onClick={() => navigate(w.to)} className={`hw-card group ${w.card}`} aria-label={`${w.title} — ${w.desc}`}>
      <div className={`hw-photo hw-${w.key}`}>
        <img
          src={`${IMG_BASE}home/${w.key}.jpg`}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
          className={`hw-img ${loaded ? 'is-on' : ''}`}
        />
      </div>
      {w.ghost && <div className="hw-ghost" style={w.ghost.style}>{w.ghost.text}</div>}
      <div className="hw-grain" />
      <div className="hw-body">
        <span className="mb-2 inline-flex items-center gap-1.5 text-[0.62rem] font-extrabold tracking-[0.16em] text-accent-2 uppercase">◆ {w.kicker}</span>
        <h3 className="font-display text-2xl leading-none text-white uppercase md:text-[1.9rem]">{w.title}</h3>
        <p className="mt-2 max-w-[34ch] text-sm text-[#d8d2c6]">{w.desc}</p>
        <div className="mt-3.5 flex items-center justify-between gap-2">
          <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-bold text-white backdrop-blur-sm">{w.stat}</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-accent-2"><span className="hidden sm:inline">Open</span> <ArrowRight /></span>
        </div>
      </div>
    </button>
  )
}

function HomeWindows() {
  return (
    <section className="mb-10 hw-grid">
      {WINDOWS.map((w) => <WindowCard key={w.key} w={w} />)}
    </section>
  )
}

export default function Home() {
  const { data, error: coreError } = useCore()
  const navigate = useNavigate()
  const toPlayer = (name: string, code?: number | null) => navigate(playerHref(name, code))
  const toTeam = (team: string) => navigate(`/teams?team=${team}`)

  const stories = useMemo(() => (data ? buildLeagueStories(data) : []), [data])

  if (!data) {
    return (
      <PageShell>
        <PageHeader title="FPL Analyser" subtitle="What matters this week — fixtures, form and captaincy, driven by the data" />
        <PageSkeleton error={coreError} />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <Hero />

      <HomeWindows />

      <GameweekCard data={data} onPlayer={toPlayer} />

      {stories.length > 0 && (
        <>
          <SectionHeader>The Briefing</SectionHeader>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {stories.map((st: Story, i: number) => <BriefingCard key={i} st={st} onPlayer={toPlayer} onTeam={toTeam} />)}
          </div>
        </>
      )}

      <GwPanel data={data} onPlayer={toPlayer} />
      <FormWatch seasonToDate={data.seasonToDate} ratings={data.ratings} onPlayer={toPlayer} />
    </PageShell>
  )
}

interface StoryBullet { iconId: string; tone: string; html: string }
interface Story {
  title: string; iconId: string; tone: string
  player?: RatingRow | null; team?: string
  score?: number | null; scoreLabel?: string; verdict?: string | null
  bullets?: StoryBullet[]
}

function BriefingCard({ st, onPlayer, onTeam }: { st: Story; onPlayer: (n: string, code?: number | null) => void; onTeam: (t: string) => void }) {
  const click = st.player ? () => onPlayer(String(st.player!.web_name), num(st.player!, 'code')) : st.team ? () => onTeam(st.team!) : undefined
  return (
    <div
      onClick={click}
      className={`rounded-xl border border-line bg-surface-1/60 p-4 ${click ? 'cursor-pointer transition-colors hover:border-line-mid hover:bg-surface-2/50' : ''}`}
    >
      <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">
        <span className={TONE_TEXT[st.tone] || 'text-accent'}><Icon name={st.iconId as IconName} size={13} /></span>
        {st.title}
      </div>
      {st.player && (
        <div className="mb-2 flex items-center gap-3">
          <PhotoByCode code={num(st.player, 'code')} element={num(st.player, 'element')} size={44} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink">{String(st.player.web_name)}</div>
            <div className="flex items-center gap-1 text-xs text-ink-2">{st.player.position} · <TeamBadge team={String(st.player.team)} size={11} />{teamFullNames[String(st.player.team)] || st.player.team} · £{st.player.price}m</div>
            {st.verdict && <div className="mt-0.5 text-xs font-medium text-ink-2">{st.verdict}</div>}
          </div>
          {st.score != null && <RadialGauge value={st.score} max={100} label={st.scoreLabel} size={74} tone={(st.tone === 'warn' ? 'warn' : 'accent') as Tone} />}
        </div>
      )}
      {st.bullets && st.bullets.length > 0 && (
        <ul className="space-y-1.5 text-sm text-ink-2">
          {st.bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className={`mt-0.5 ${TONE_TEXT[b.tone] || 'text-info'}`}><Icon name={b.iconId as IconName} size={14} /></span>
              <span dangerouslySetInnerHTML={{ __html: b.html }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The gameweek decision card: the model's captain, differential and value
 *  picks at a glance — the "what do I do this week" moment on the home page. */
function GameweekCard({ data, onPlayer }: { data: CoreData; onPlayer: (n: string, code?: number | null) => void }) {
  const nextGw = data.meta?.next_gw ?? null
  const picks = useMemo(() => {
    const rated = (data.ratings as RatingRow[]).filter(
      (p) => num(p, 'season_ok') !== 0 && p.season_ok !== false && num(p, 'season_overall_score') != null,
    )
    const nextFix = (team: string) => (data.fixtureEase || []).filter((f) => f.team === team).sort((a, b) => a.gw - b.gw)[0]
    const rating = (p: RatingRow) => (num(p, 'season_overall_score') ?? 0) * 20
    const fixFactor = (p: RatingRow) => { const f = nextFix(String(p.team)); return f ? (6 - f.fdr) / 5 : 0.6 }
    const att = rated.filter((p) => p.position === 'MID' || p.position === 'FWD')
    const captain = [...att].sort((a, b) => rating(b) * fixFactor(b) - rating(a) * fixFactor(a))[0]
    const diff = [...rated].filter((p) => (num(p, 'selected_by_percent') ?? 100) < 10 && nextFix(String(p.team))).sort((a, b) => rating(b) - rating(a))[0]
    const value = [...rated].filter((p) => (num(p, 'price') ?? 0) > 0).sort((a, b) => rating(b) / (num(b, 'price') ?? 1) - rating(a) / (num(a, 'price') ?? 1))[0]
    return { captain, diff, value, nextFix, rating }
  }, [data])

  if (!picks.captain) return null
  const fixLabel = (p: RatingRow) => {
    const f = picks.nextFix(String(p.team))
    return f ? `${f.venue === 'H' ? 'vs' : '@'} ${f.opponent}` : ''
  }

  const Pick = ({ label, icon, p, note }: { label: string; icon: IconName; p?: RatingRow; note: string }) => {
    if (!p) return null
    return (
      <button onClick={() => onPlayer(String(p.web_name), num(p, 'code'))} className="flex flex-1 items-center gap-3 rounded-xl border border-line bg-surface-1/60 p-3 text-left transition-colors hover:border-line-mid hover:bg-surface-2/50">
        <PhotoByCode code={num(p, 'code')} element={num(p, 'element')} size={40} />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold tracking-[0.1em] text-accent uppercase"><Icon name={icon} size={12} />{label}</div>
          <div className="truncate text-sm font-semibold text-ink">{String(p.web_name)}</div>
          <div className="truncate text-[11px] text-ink-3">{note} · {fixLabel(p)}</div>
        </div>
        <StarRating value={num(p, 'season_overall_score')} size={12} />
      </button>
    )
  }

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-1.5">
        <h2 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">{nextGw ? `Gameweek ${nextGw} — the model's picks` : "The model's picks"}</h2>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Pick label="Captain" icon="crown" p={picks.captain} note={`${Math.round(picks.rating(picks.captain))} rated`} />
        <Pick label="Differential" icon="eye" p={picks.diff} note={picks.diff ? `${Math.round(num(picks.diff, 'selected_by_percent') ?? 0)}% owned` : ''} />
        <Pick label="Value" icon="coin" p={picks.value} note={picks.value ? `£${num(picks.value, 'price')}m` : ''} />
      </div>
      <p className="mt-2 text-xs text-ink-3">Highest-rated captaincy for the fixture, a sub-10%-owned differential, and the best rating-per-million — tap for the full profile.</p>
    </section>
  )
}

function GwPanel({ data, onPlayer }: { data: CoreData; onPlayer: (n: string, code?: number | null) => void }) {
  const nextGw = data.meta?.next_gw ?? null
  const metaLine = () => {
    const m = data.meta
    if (!m?.generated_at) return ''
    const date = new Date(m.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    return `Data updated ${date}${m.current_gw ? ` · data through GW${m.current_gw}` : ''}`
  }
  const seasonOk = data.ratings.filter((p) => num(p, 'season_ok') !== 0 && p.season_ok !== false) as RatingRow[]

  const toItems = (rows: RatingRow[], value: (p: RatingRow) => ReactNode): DashItem[] =>
    rows.map((p, i) => ({ rank: i + 1, name: String(p.web_name), code: num(p, 'code'), element: num(p, 'element'), pos: String(p.position), team: String(p.team), value: value(p) }))

  if (!nextGw) {
    const topRated = [...seasonOk].sort((a, b) => (num(b, 'season_overall_score') ?? 0) - (num(a, 'season_overall_score') ?? 0)).slice(0, 5)
    const topPPG = [...seasonOk].sort((a, b) => (num(b, 'season_ppg') ?? 0) - (num(a, 'season_ppg') ?? 0)).slice(0, 5)
    return (
      <>
        <SectionHeader>Season Complete</SectionHeader>
        <p className="mb-3 -mt-1 text-sm text-ink-3">{metaLine()} — the weekly panel (deadline, captaincy picks, fixture swings) switches on when next season's fixtures land.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <DashCard title="Season Top Rated" icon={<span className="text-accent"><Icon name="star" size={14} /></span>} items={toItems(topRated, (p) => <StarRating value={str(p, 'season_overall_rating')} size={10} showNum={false} />)} onPlayer={onPlayer} />
          <DashCard title="Season Top PPG" icon={<span className="text-accent"><Icon name="coin" size={14} /></span>} items={toItems(topPPG, (p) => (num(p, 'season_ppg') != null ? `${num(p, 'season_ppg')!.toFixed(1)} ppg` : 'N/A'))} onPlayer={onPlayer} />
        </div>
      </>
    )
  }

  const captains = [...seasonOk].filter((p) => num(p, 'next4_score') != null).sort((a, b) => (num(b, 'next4_score') ?? 0) - (num(a, 'next4_score') ?? 0)).slice(0, 5)
  return (
    <>
      <SectionHeader>Gameweek {nextGw}</SectionHeader>
      <p className="mb-3 -mt-1 text-sm text-ink-3">{metaLine()}</p>
      {captains.length > 0 && (
        <DashCard
          title="Captaincy Shortlist — form × fixtures (next 4 GWs)"
          icon={<span className="text-accent"><Icon name="crown" size={14} /></span>}
          items={toItems(captains, (p) => (
            <span className="flex items-center gap-1">
              <StarRating value={str(p, 'next4_overall_rating')} size={10} showNum={false} />
              {num(p, 'next4_fixture_factor') != null && <span className="text-[11px] text-ink-3">×{num(p, 'next4_fixture_factor')!.toFixed(2)}</span>}
            </span>
          ))}
          onPlayer={onPlayer}
        />
      )}
    </>
  )
}

function FormWatch({ seasonToDate, ratings, onPlayer }: { seasonToDate: Row[]; ratings: RatingRow[]; onPlayer: (n: string, code?: number | null) => void }) {
  const codeByName = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const p of ratings) m.set(String(p.web_name), num(p, 'code'))
    return m
  }, [ratings])
  const hot = seasonToDate.filter((p) => str(p, 'streak') === '🔥 Hot').sort((a, b) => (num(b, 'pts_delta') ?? 0) - (num(a, 'pts_delta') ?? 0)).slice(0, 5)
  const cold = seasonToDate.filter((p) => str(p, 'streak') === '🧊 Cold').sort((a, b) => (num(a, 'pts_delta') ?? 0) - (num(b, 'pts_delta') ?? 0)).slice(0, 5)
  if (!hot.length && !cold.length) return null

  const toItems = (rows: Row[], sign: boolean): DashItem[] =>
    rows.map((p, i) => ({
      rank: i + 1, name: String(p.web_name), code: codeByName.get(String(p.web_name)) ?? null, element: num(p, 'element'), pos: String(p.position), team: String(p.team),
      value: <span className={sign ? 'text-hot' : 'text-cold'}>{sign ? '+' : ''}{(num(p, 'pts_delta') ?? 0).toFixed(1)}</span>,
    }))

  return (
    <>
      <SectionHeader>Form Watch</SectionHeader>
      <div className="grid gap-3 md:grid-cols-2">
        <DashCard title="Hot Streak" icon={<span className="text-hot"><Icon name="flame" size={14} solid /></span>} items={toItems(hot, true)} onPlayer={onPlayer} />
        <DashCard title="Cold Streak" icon={<span className="text-cold"><Icon name="snow" size={14} /></span>} items={toItems(cold, false)} onPlayer={onPlayer} />
      </div>
    </>
  )
}
