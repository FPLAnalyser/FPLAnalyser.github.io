import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageShell } from '../components/PageShell'
import { PageSkeleton } from '../components/Skeleton'
import { PlayerPhoto } from '../components/PlayerPhoto'
import { RadialGauge, type Tone } from '../components/viz'
import { StarRating } from '../components/StarRating'
import { TeamBadge } from '../components/badges'
import { Icon, type IconName } from '../components/Icon'
import { useCore } from '../lib/useData'
import { num, str } from '../lib/rows'
import { teamFullNames } from '../lib/util'
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
function DashCard({ title, icon, items, onPlayer }: { title: string; icon: ReactNode; items: DashItem[]; onPlayer: (name: string) => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1/60 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">{icon}{title}</div>
      <div className="flex flex-col">
        {items.map((it) => (
          <button key={it.rank} onClick={() => onPlayer(it.name)} className="flex items-center gap-3 border-b border-line py-2 text-left last:border-0 transition-colors hover:bg-surface-2/50">
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
  const navigate = useNavigate()
  const savedTeam = (() => { try { return localStorage.getItem('fpl_team_id') } catch { return null } })()
  return (
    <section className="mb-12">
      <p className="mb-4 text-[11px] font-semibold tracking-[0.28em] text-accent uppercase">Data. Insight. Points.</p>
      <h1 className="max-w-3xl text-3xl leading-[1.08] font-extrabold tracking-[-0.02em] text-ink md:text-5xl">
        Turn Premier League data into FPL points.
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-2 md:text-lg">
        FPL Analyser rates every player on the numbers that actually predict returns — expected goals, minutes, form and
        fixtures — then turns them into a plain-language verdict and transfer calls for <em>your</em> team.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate('/loadteam')}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
        >
          {savedTeam ? 'Open your team report' : 'Load your team'}
          <Icon name="trend-up" size={16} />
        </button>
        <button
          onClick={() => navigate('/rankings')}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-mid px-5 font-semibold text-ink transition-colors hover:border-line-strong"
        >
          Browse the rankings
        </button>
        {savedTeam && <span className="text-sm text-ink-3">Welcome back — your squad is saved.</span>}
      </div>

      <div className="mt-9 grid gap-3 sm:grid-cols-3">
        <Pillar icon="target" title="Data" body="We start with the underlying numbers — expected goals, minutes, percentiles versus peers — not last week's points." />
        <Pillar icon="eye" title="Insight" body="Every player gets a rating out of 100, a persona, and a plain-language verdict you can actually act on." />
        <Pillar icon="trophy" title="Points" body="Load your squad for personalised alerts, captaincy and transfers — all pointed at one thing: more points." />
      </div>
    </section>
  )
}

function Pillar({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent"><Icon name={icon} size={16} /></span>
        <span className="text-sm font-bold tracking-wide text-ink uppercase">{title}</span>
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{body}</p>
    </div>
  )
}

export default function Home() {
  const { data, error: coreError } = useCore()
  const navigate = useNavigate()
  const toPlayer = (name: string) => navigate(`/player?name=${encodeURIComponent(name)}`)
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

function BriefingCard({ st, onPlayer, onTeam }: { st: Story; onPlayer: (n: string) => void; onTeam: (t: string) => void }) {
  const click = st.player ? () => onPlayer(String(st.player!.web_name)) : st.team ? () => onTeam(st.team!) : undefined
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

function GwPanel({ data, onPlayer }: { data: CoreData; onPlayer: (n: string) => void }) {
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

function FormWatch({ seasonToDate, ratings, onPlayer }: { seasonToDate: Row[]; ratings: RatingRow[]; onPlayer: (n: string) => void }) {
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
