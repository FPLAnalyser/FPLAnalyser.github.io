import { type ReactNode } from 'react'
import { FixtureChips } from './FixtureChips'
import { num, str, bool } from '../lib/rows'
import type { CoreData, FixtureEaseRow, RatingRow, Row } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   The player story layer: every module opens with a plain-language sentence
   and shows the numbers as evidence. Archetype-aware — rotation gambles,
   enablers, unknowns and hot/cold runs each get their honest template.
   ════════════════════════════════════════════════════════════════════════ */

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'cold'
const TONE_TEXT: Record<Tone, string> = {
  good: 'text-good', warn: 'text-warn', bad: 'text-bad', info: 'text-info', cold: 'text-cold',
}
const pct = (v: number | null | undefined) => (v == null ? null : `${Math.round(v * 100)}%`)

/* ── shared atoms ── */

function Sentence({ children }: { children: ReactNode }) {
  return <p className="text-[16.5px] leading-snug font-semibold tracking-[-0.01em] text-ink [&_em]:not-italic [&_em]:text-accent-2">{children}</p>
}

function Support({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{children}</p>
}

function Kick({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-extrabold tracking-[0.2em] text-accent-2 uppercase">{children}</div>
}

function ModuleCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-surface-1 p-4">{children}</div>
}

/** Horizontal evidence bar: label · bar (percentile width) · value. */
function BarRow({ label, width, value, tone }: { label: string; width: number; value: string; tone?: 'gold' | 'good' | 'warn' | 'bad' | 'info' }) {
  const grad: Record<string, string> = {
    gold: 'linear-gradient(90deg, var(--accent-strong), var(--accent-2))',
    good: 'linear-gradient(90deg, #1d7a49, #3ddc7a)',
    warn: 'linear-gradient(90deg, #a06c19, #e8b04a)',
    bad: 'linear-gradient(90deg, #8f2f2c, #f0736f)',
    info: 'linear-gradient(90deg, #2f5fa8, #6ea8ff)',
  }
  return (
    <div className="grid grid-cols-[94px_1fr_56px] items-center gap-2.5 text-[13px]">
      <span className="text-[11px] font-bold tracking-[0.07em] text-ink-2 uppercase">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, width))}%`, background: grad[tone ?? 'gold'] }} />
      </div>
      <span className="text-right font-num font-extrabold tabular-nums">{value}</span>
    </div>
  )
}

function Bars({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-col gap-2">{children}</div>
}

/* ── field helpers ── */
const f = (r: RatingRow, k: string) => num(r, `season_m_${k}`)
const fp = (r: RatingRow, k: string) => num(r, `season_pct_${k}`) // percentile 0–100 vs positional peers

/* ════════ Reads: the sentence engine's judgements ════════ */

export interface Read { word: string; tone: Tone; sub: string }

export function minutesRead(r: RatingRow): Read {
  const sr = num(r, 'season_start_rate')
  const m90 = num(r, 'season_mins90_rate')
  const starts = num(r, 'total_starts')
  if (sr == null) return { word: 'No PL minutes', tone: 'info', sub: 'Unrated until games are played' }
  if (sr >= 0.85 && (m90 ?? 0) >= 0.6) return { word: 'Nailed', tone: 'good', sub: `Starts ${pct(sr)} of games · full 90 in ${pct(m90)}` }
  if (sr >= 0.85) return { word: 'Starts, gets hooked', tone: 'good', sub: `${pct(sr)} starts but only ${pct(m90) ?? 'few'} full 90s` }
  // Availability vs selection: a player who plays the full 90 whenever he
  // starts, with no sub cameos, isn't being rotated — he's been unavailable
  // (injury/suspension). Never call that a rotation risk.
  if (sr >= 0.35 && (m90 ?? 0) >= 0.75) {
    return sr >= 0.55
      ? { word: 'Starts when fit', tone: 'good', sub: `${starts != null ? `${starts} starts` : pct(sr) + ' of games'}, full shifts when he plays — absences were fitness, not selection` }
      : { word: 'Starter when available', tone: 'warn', sub: `First choice when fit, but missed ${pct(1 - sr)} of games — check availability` }
  }
  if (sr >= 0.55) return { word: 'Rotation risk', tone: 'warn', sub: `Only ${pct(sr)} starts and hooked or benched often — a coin-flip most weeks` }
  return { word: 'Fringe player', tone: 'bad', sub: `${pct(sr)} starts — minutes are the whole problem` }
}

export function formRead(r: RatingRow): Read | null {
  const ppg = num(r, 'season_ppg')
  const xpg = num(r, 'season_xpts_per_game')
  if (ppg == null || xpg == null) return null
  const d = ppg - xpg
  if (d > 0.35) return { word: 'Running hot', tone: 'warn', sub: `+${d.toFixed(1)} pts/game above expected — may cool` }
  if (d < -0.35) return { word: 'Running cold', tone: 'cold', sub: `${d.toFixed(1)} vs expected — due an uptick` }
  return { word: 'Sustainable', tone: 'good', sub: 'Output matches the underlying numbers' }
}

export function valueRead(r: RatingRow): Read | null {
  const ppg = num(r, 'season_ppg')
  const price = num(r, 'price')
  if (ppg == null || !price) return null
  const v = ppg / price
  const vr = num(r, 'season_value_score_rating')
  return {
    word: `${v.toFixed(1)} pts/£m`,
    tone: v >= 0.75 ? 'good' : v >= 0.5 ? 'info' : 'warn',
    sub: vr != null ? `Value rating ${Math.round(vr)}/100 vs position` : `£${price}m`,
  }
}

/** Combined attacking share of the team (xG + xA) — the talisman number. */
function talismanShare(m: Row | null): number | null {
  if (!m) return null
  const xg = num(m, 'xg_share_season') ?? num(m, 'xg_share_4gw')
  const xa = num(m, 'xa_share_season') ?? num(m, 'xa_share_4gw')
  if (xg == null && xa == null) return null
  return ((xg ?? 0) + (xa ?? 0)) / 2
}

/** Player archetype — drives which story modules render. */
export function archetypeOf(r: RatingRow): 'unknown' | 'rotation' | 'enabler' | 'standard' {
  const overall = num(r, 'season_overall_score')
  if (overall == null) return 'unknown'
  const sr = num(r, 'season_start_rate')
  const m90 = num(r, 'season_mins90_rate')
  const rating = overall * 20
  const price = num(r, 'price') ?? 99
  if (sr != null && sr >= 0.8 && rating <= 58 && price <= 4.8) return 'enabler'
  // Real rotation shows up as partial games (hooked early, sub cameos). A
  // full-shift player with a sub-85% start rate was absent, not rotated.
  if (sr != null && sr >= 0.35 && sr < 0.85 && (m90 ?? 0) < 0.75) return 'rotation'
  return 'standard'
}

/* ════════ Decision row ════════ */

function fixtureSummary(fixtureEase: FixtureEaseRow[], team: string) {
  const up = fixtureEase.filter((fx) => fx.team === team).sort((a, b) => a.gw - b.gw).slice(0, 4)
  if (!up.length) return null
  const avgFdr = up.reduce((s, fx) => s + (fx.fdr || 3), 0) / up.length
  return Math.round(((5 - avgFdr) / 4) * 100)
}

function DCell({ label, read }: { label: string; read: Read | null }) {
  if (!read) return null
  return (
    <div className="bg-bg-1 px-4 py-3">
      <div className="mb-1 text-[10px] font-extrabold tracking-[0.16em] text-ink-3 uppercase">{label}</div>
      <div className={`text-[16px] font-extrabold ${TONE_TEXT[read.tone]}`}>{read.word}</div>
      <div className="mt-0.5 text-[12.5px] text-ink-2">{read.sub}</div>
    </div>
  )
}

export function DecisionRow({ r, fixtureEase }: { r: RatingRow; fixtureEase: FixtureEaseRow[] }) {
  const ease = fixtureSummary(fixtureEase, String(r.team))
  const hasFix = fixtureEase.some((fx) => fx.team === String(r.team))
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      <DCell label="Minutes" read={minutesRead(r)} />
      {hasFix && (
        <div className="bg-bg-1 px-4 py-3">
          <div className="mb-1 text-[10px] font-extrabold tracking-[0.16em] text-ink-3 uppercase">Next 4{ease != null ? ` · ease ${ease}` : ''}</div>
          <div className="mt-1.5"><FixtureChips fixtureEase={fixtureEase} team={String(r.team)} n={4} /></div>
        </div>
      )}
      <DCell label="Form vs expected" read={formRead(r)} />
      <DCell label="Value" read={valueRead(r)} />
    </div>
  )
}

/* ════════ Story modules ════════ */

function Module({ kick, sentence, support, children }: { kick: string; sentence: ReactNode; support?: ReactNode; children?: ReactNode }) {
  return (
    <ModuleCard>
      <Kick>{kick}</Kick>
      <Sentence>{sentence}</Sentence>
      {children}
      {support && <Support>{support}</Support>}
    </ModuleCard>
  )
}

/* — per-position + archetype module builders. Each returns null when the data
     doesn't support the story, so the grid only shows what's real. — */

function PerStartModule({ r }: { r: RatingRow }) {
  const starts = num(r, 'total_starts')
  const pts = num(r, 'total_points')
  const ppg = num(r, 'season_ppg')
  if (!starts || pts == null || ppg == null || starts < 3) return null
  const perStart = pts / starts
  if (perStart - ppg < 0.5) return null
  return (
    <Module
      kick="The per-start truth"
      sentence={<>When he starts, he's a <em>{perStart.toFixed(1)} pts/game</em> player.</>}
      support={<>The gap between the two bars is the rotation cost — points paid every week to his manager's squad depth.</>}
    >
      <Bars>
        <BarRow label="Per start" width={perStart * 13} value={perStart.toFixed(1)} tone="good" />
        <BarRow label="Per gameweek" width={ppg * 13} value={ppg.toFixed(1)} tone="warn" />
      </Bars>
    </Module>
  )
}

function TalismanModule({ r, m }: { r: RatingRow; m: Row | null }) {
  const share = talismanShare(m)
  if (share == null || share < 0.08) return null
  const p = Math.round(share * 100)
  const team = String(r.team)
  const s =
    share >= 0.3 ? <>Elite talisman — <em>{p}% of {team}'s attack</em> runs through him.</> :
    share >= 0.2 ? <><em>{p}% of everything {team} create</em> — the focal point.</> :
    share >= 0.13 ? <>A key piece: <em>{p}%</em> of the team's chance creation.</> :
    <>One of many — only <em>{p}%</em> of the team's attack.</>
  return (
    <Module
      kick="The talisman case"
      sentence={s}
      support={<>Share of the team's combined xG + xA. Above 30% is elite territory; under 13% means his ceiling depends on team-mates' service.</>}
    >
      <div className="mt-3 flex items-center gap-4">
        <div className="relative size-[92px] shrink-0 rounded-full" style={{ background: `conic-gradient(var(--accent) 0 ${p}%, rgba(255,255,255,.09) ${p}% 100%)` }}>
          <div className="absolute inset-[9px] rounded-full bg-surface-1" />
          <div className="metallic-num absolute inset-0 grid place-items-center font-num text-xl font-extrabold tabular-nums">{p}%</div>
        </div>
        <div className="text-[13px] text-ink-2">of team xG + xA</div>
      </div>
    </Module>
  )
}

function CreatorModule({ r }: { r: RatingRow }) {
  const xa = f(r, 'xa')
  if (xa == null) return null
  const chances = f(r, 'chances')
  const sp = f(r, 'set_piece')
  const pxa = fp(r, 'xa') ?? 0
  const top = pxa >= 80
  return (
    <Module
      kick="Creation"
      sentence={top
        ? <>A <em>chance machine</em> — top {Math.max(1, 100 - Math.round(pxa))}% of his position for expected assists.</>
        : pxa >= 55 ? <>Solid creator: <em>{xa.toFixed(2)} xA per 90</em>, above the positional average.</>
        : <>Creation isn't the game — <em>{xa.toFixed(2)} xA/90</em> puts assists on the rare side.</>}
      support={sp != null && sp >= 2 ? <>Set-piece delivery ({sp.toFixed(1)}/90) keeps the assist floor alive even in games he plays badly.</> : undefined}
    >
      <Bars>
        <BarRow label="xA / 90" width={pxa} value={xa.toFixed(2)} />
        {chances != null && <BarRow label="Chances" width={fp(r, 'chances') ?? 0} value={chances.toFixed(1)} />}
        {sp != null && sp > 0.3 && <BarRow label="SP delivery" width={fp(r, 'set_piece') ?? 0} value={sp.toFixed(1)} />}
      </Bars>
    </Module>
  )
}

function FinishingModule({ r }: { r: RatingRow }) {
  const goals = num(r, 'total_goals')
  const xg = num(r, 'total_xg')
  if (goals == null || xg == null || xg < 1.5) return null
  const d = goals - xg
  const s =
    d >= 1.5 ? <><em>{goals} goals from {xg.toFixed(1)} xG</em> — clinical, or borrowing from the future.</> :
    d <= -1.5 ? <><em>{xg.toFixed(1)} xG, {goals} goals</em> — the luck debt is owed to him.</> :
    <>Scoring <em>in line with the chances</em> — {goals} goals from {xg.toFixed(1)} xG.</>
  const support =
    d >= 1.5 ? <>Finishing this far above expected rarely holds. If the shot volume stays, fine — if it thins, the goals go with it.</> :
    d <= -1.5 ? <>Chance quality intact, finishing cold. Historically this gap closes — the contrarian window is open while others sell.</> :
    <>No luck debt either way: what you see is what you keep getting.</>
  const maxW = Math.max(goals, xg)
  return (
    <Module kick="Finishing" sentence={s} support={support}>
      <Bars>
        <BarRow label="Goals" width={(goals / maxW) * 88} value={String(goals)} tone={d <= -1.5 ? 'bad' : 'good'} />
        <BarRow label="xG" width={(xg / maxW) * 88} value={xg.toFixed(1)} tone="info" />
      </Bars>
    </Module>
  )
}

/** The Def Con read, shared by the module and the brief. Phrases from the
 * percentile vs position and the distance to the actions threshold — never
 * from the raw hit rate alone (a 29% rate can be the 80th percentile). */
export function defConRead(r: RatingRow): { hit: number; pctl: number | null; actions: number; threshold: number; gap: number; sentence: ReactNode; support: string } | null {
  const hit = f(r, 'dc_hit')
  if (hit == null) return null
  const isMid = r.position === 'MID' || r.position === 'FWD'
  // FPL thresholds: defenders need 10 CBIT actions; mids/forwards need 12
  // including recoveries.
  const threshold = isMid ? 12 : 10
  const actions = (f(r, 'cbi') ?? 0) + (f(r, 'tackles') ?? 0) + (isMid ? f(r, 'recoveries') ?? 0 : 0)
  const pctl = fp(r, 'dc_hit')
  const gap = threshold - actions
  const posLabel = isMid ? 'midfielders' : 'defenders'
  const sentence: ReactNode =
    hit >= 0.55 ? <>Banks the <em>+2 Def Con in {pct(hit)} of starts</em> — points without a clean sheet.</> :
    (pctl ?? 0) >= 70 || (gap <= 1.5 && hit >= 0.2) ? <><em>Knocking on the Def Con door</em> — +2 in {pct(hit)} of starts, more than {pctl != null ? `${Math.round(pctl / 10) * 10}% of ${posLabel}` : 'most peers'} manage.</> :
    hit >= 0.3 ? <>Hits the Def Con threshold <em>every other week</em> ({pct(hit)}).</> :
    <>Rarely hits the Def Con threshold ({pct(hit)}) — <em>clean sheets or nothing</em>.</>
  const support =
    hit >= 0.55 ? `${actions.toFixed(1)} defensive actions per 90 — the threshold is routine, not lucky. Even on a bad night he scores.` :
    gap <= 1.5 ? `${actions.toFixed(1)} defensive actions per 90, within ${gap <= 1 ? 'one action' : gap.toFixed(1) + ' actions'} of the ${threshold} threshold — kind fixtures tip him over.` :
    (pctl ?? 0) >= 50 || hit >= 0.3 ? `${actions.toFixed(1)} defensive actions per 90 against a threshold of ${threshold} — above average for the position, but the +2 stays matchup-dependent.` :
    `${actions.toFixed(1)} defensive actions per 90 against a threshold of ${threshold} — the volume isn't there.`
  return { hit, pctl, actions, threshold, gap, sentence, support }
}

function DefConModule({ r }: { r: RatingRow }) {
  const d = defConRead(r)
  if (!d) return null
  const isMid = r.position === 'MID' || r.position === 'FWD'
  if (isMid && (fp(r, 'dc_hit') ?? 0) < 55) return null // only a story for defensive mids
  return (
    <Module
      kick={isMid ? 'The midfield floor' : 'The floor — points without a clean sheet'}
      sentence={d.sentence}
      support={d.actions > 0 ? d.support : undefined}
    >
      <Bars>
        <BarRow label="DC hits" width={d.hit * 100} value={pct(d.hit) ?? '—'} tone={d.hit >= 0.55 ? 'good' : (d.pctl ?? 0) >= 70 || d.hit >= 0.3 ? 'gold' : 'bad'} />
        <BarRow label={isMid ? 'CBIT+R / 90' : 'CBIT / 90'} width={Math.min(100, (d.actions / d.threshold) * 100)} value={d.actions.toFixed(1)} />
      </Bars>
    </Module>
  )
}

function FloorCeilingModule({ r, data }: { r: RatingRow; data: CoreData }) {
  const cs = f(r, 'cs_rate')
  if (cs == null) return null
  const xgxa = (f(r, 'xg') ?? 0) + (f(r, 'xa') ?? 0)
  const box = f(r, 'touches_box')
  const headedPct = fp(r, 'headed')
  const spTarget = headedPct != null && headedPct >= 72
  const teamRating = (data.teamRatings ?? []).find((t) => t.team === String(r.team) && str(t, 'window') === 'season')
  const defRank = teamRating ? num(teamRating, 'defence_rank') : null
  const attacking = xgxa >= 0.18 || (box ?? 0) >= 1.2
  const s = attacking
    ? <>Clean-sheet floor <em>plus</em> a genuine goal threat.</>
    : <>A <em>pure defensive pick</em> — the attacking ceiling is low and that's the deal.</>
  const defShare = Math.round((cs / (cs + Math.min(0.5, xgxa) + 0.001)) * 100)
  return (
    <Module
      kick="Floor vs ceiling"
      sentence={s}
      support={
        <>
          Clean sheets in {pct(cs)} of starts{defRank != null ? ` behind the league's #${defRank} defence` : ''}.
          {attacking ? <> Going forward: {xgxa.toFixed(2)} xG+xA and {box?.toFixed(1) ?? '—'} box touches per 90{spTarget ? ' — a set-piece target at corners' : ''}.</> : <> {xgxa.toFixed(2)} xG+xA per 90 going forward — budget accordingly.</>}
        </>
      }
    >
      <div className="mt-3 flex h-3.5 overflow-hidden rounded-full">
        <span style={{ width: `${defShare}%`, background: 'linear-gradient(90deg,#1d7a49,#3ddc7a)' }} />
        <span style={{ width: `${100 - defShare}%`, background: 'linear-gradient(90deg, var(--accent-strong), var(--accent-2))' }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-2">
        <span><b className="text-good">Defensive</b> — CS {pct(cs)}</span>
        <span><b className="metallic-num">Attacking</b> — {xgxa.toFixed(2)} xG+xA/90</span>
      </div>
    </Module>
  )
}

function KeeperModules({ r, data }: { r: RatingRow; data: CoreData }) {
  const cs = f(r, 'cs_rate')
  const xgc = f(r, 'xgc')
  const prevented = f(r, 'prevented')
  const saves = f(r, 'saves')
  const faced = f(r, 'shots_faced')
  const teamRating = (data.teamRatings ?? []).find((t) => t.team === String(r.team) && str(t, 'window') === 'season')
  const defRank = teamRating ? num(teamRating, 'defence_rank') : null
  const busy = faced != null && faced >= 4.3
  return (
    <>
      {cs != null && (
        <Module
          kick="The clean-sheet floor"
          sentence={defRank != null && defRank <= 4
            ? <>The league's <em>#{defRank} defence</em> plays in front of him.</>
            : <>Clean sheets in <em>{pct(cs)}</em> of starts{defRank != null ? ` — a #${defRank}-ranked defence` : ''}.</>}
          support={xgc != null ? <>{xgc.toFixed(2)} expected goals conceded per 90 — the clean-sheet odds start with the team, not the keeper.</> : undefined}
        >
          <Bars>
            <BarRow label="CS rate" width={(cs ?? 0) * 160} value={pct(cs) ?? '—'} tone="good" />
            {xgc != null && <BarRow label="xGC / 90" width={100 - (fp(r, 'xgc') ?? 50)} value={xgc.toFixed(2)} tone="info" />}
          </Bars>
        </Module>
      )}
      {prevented != null && (
        <Module
          kick="Shot-stopping"
          sentence={prevented >= 0.08 ? <>Saves <em>{prevented >= 0 ? '+' : ''}{prevented.toFixed(2)} goals per 90</em> more than an average keeper would.</>
            : prevented <= -0.08 ? <>Concedes <em>{Math.abs(prevented).toFixed(2)} goals per 90 more</em> than the shots deserve.</>
            : <>Stops what he should — <em>league-average</em> shot-stopping.</>}
          support={busy
            ? <>{faced!.toFixed(1)} shots faced a game — a busy keeper, so save points are his real floor.</>
            : faced != null ? <>Only {faced.toFixed(1)} shots faced a game — the quiet cost of a good defence: his value is the clean sheet, not the stops.</> : undefined}
        >
          <Bars>
            <BarRow label="Prevented" width={fp(r, 'prevented') ?? 0} value={`${prevented >= 0 ? '+' : ''}${prevented.toFixed(2)}`} tone={prevented >= 0.08 ? 'good' : prevented <= -0.08 ? 'bad' : 'gold'} />
            {saves != null && <BarRow label="Saves / 90" width={fp(r, 'saves') ?? 0} value={saves.toFixed(1)} tone={busy ? 'good' : 'gold'} />}
          </Bars>
        </Module>
      )}
    </>
  )
}

function WhatHeIsntModule({ r }: { r: RatingRow }) {
  const xgxa = (f(r, 'xg') ?? 0) + (f(r, 'xa') ?? 0)
  const box = f(r, 'touches_box')
  return (
    <Module
      kick="What he isn't"
      sentence={<>Attacking threat: <em className="text-bad">bottom of the class</em>. Zero pretence.</>}
      support={<>We show the weakness plainly — the honesty is what makes the "buy him anyway" case trustworthy. He's priced for the £s he frees up, not the points he scores.</>}
    >
      <Bars>
        <BarRow label="xG+xA / 90" width={Math.max(fp(r, 'xg') ?? 0, 4)} value={xgxa.toFixed(2)} tone="bad" />
        {box != null && <BarRow label="Box touches" width={fp(r, 'touches_box') ?? 0} value={box.toFixed(1)} tone="bad" />}
      </Bars>
    </Module>
  )
}

export function UnknownModules({ r }: { r: RatingRow }) {
  const pen = bool(r, 'is_pen_taker')
  const sp = bool(r, 'is_setpiece_taker')
  const roles = [pen && 'the penalties', sp && 'set pieces'].filter(Boolean) as string[]
  return (
    <>
      <Module
        kick="What we know"
        sentence={roles.length
          ? <>He's expected to take <em>{roles.join(' and ')}</em> — role signals survive transfers better than output does.</>
          : <>A projected starter at <em>£{num(r, 'price')}m</em> — that's the extent of the hard evidence.</>}
        support={<>Price bracket, role flags and the fixture run are real signals. Anything more would be a guess dressed as a number.</>}
      />
      <Module
        kick="What we don't"
        sentence={<>Whether his game survives <em className="text-warn">a Premier League defence</em>.</>}
        support={<>No shot map, no percentiles, no 0–100 — deliberately blank rather than fabricated. Live data replaces this panel the moment he plays real minutes.</>}
      >
        <div className="mt-3 rounded-lg border border-dashed border-line-mid px-3 py-2.5 text-xs text-ink-3">
          Shot map and rating appear after his first PL minutes — we don't fabricate evidence.
        </div>
      </Module>
    </>
  )
}

export function StoryModules({ r, data }: { r: RatingRow; data: CoreData }) {
  const arch = archetypeOf(r)
  const m = data.metrics.find((x) => x.element === r.element) ?? null
  const pos = String(r.position)

  if (arch === 'unknown') {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2"><UnknownModules r={r} /></div>
    )
  }

  const modules: ReactNode[] = []
  if (arch === 'rotation') modules.push(<PerStartModule key="ps" r={r} />)

  if (pos === 'GKP') {
    modules.push(<KeeperModules key="gk" r={r} data={data} />)
  } else if (pos === 'DEF') {
    modules.push(<DefConModule key="dc" r={r} />)
    modules.push(<FloorCeilingModule key="fc" r={r} data={data} />)
    if (arch === 'enabler') modules.push(<WhatHeIsntModule key="wi" r={r} />)
    else {
      const spDeliv = f(r, 'set_piece')
      if ((fp(r, 'xa') ?? 0) >= 65 || (spDeliv ?? 0) >= 1.5) modules.push(<CreatorModule key="cr" r={r} />)
    }
  } else {
    // MID / FWD — order creator vs finishing by which is the stronger suit
    const creatorFirst = (fp(r, 'xa') ?? 0) > (fp(r, 'xg') ?? 0)
    modules.push(<TalismanModule key="tal" r={r} m={m} />)
    if (creatorFirst) {
      modules.push(<CreatorModule key="cr" r={r} />, <FinishingModule key="fin" r={r} />)
    } else {
      modules.push(<FinishingModule key="fin" r={r} />, <CreatorModule key="cr" r={r} />)
    }
    modules.push(<DefConModule key="dc" r={r} />)
    if (arch === 'enabler') modules.push(<WhatHeIsntModule key="wi" r={r} />)
  }

  return <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">{modules}</div>
}

/* ════════ Matchup character (replaces the tier table) ════════ */

export function MatchupBars({ element, tierPerf }: { element: number; tierPerf: Row[] }) {
  const rows = tierPerf.filter((x) => num(x, 'element') === element)
  if (!rows.length) return null
  const tier = (t: string) => rows.find((x) => str(x, 'opponent_tier')?.startsWith(t)) ?? null
  const specs = [
    ['Tier 1', 'vs Top 6'],
    ['Tier 2', 'vs Mid'],
    ['Tier 3', 'vs Rest'],
  ] as const
  const vals = specs.map(([key, label]) => {
    const row = tier(key)
    const games = row ? num(row, 'games_played') : null
    return { label, pts: row ? num(row, 'avg_pts') : null, games }
  }).filter((v) => v.pts != null && (v.games ?? 0) >= 2)
  if (vals.length < 2) return null
  const max = Math.max(...vals.map((v) => v.pts as number), 0.1)
  const top = vals[0].pts as number
  const bottom = vals[vals.length - 1].pts as number
  const s =
    bottom - top >= 1.3 ? <>A <em>flat-track bully</em> — {bottom.toFixed(1)} ppg against the weak, {top.toFixed(1)} against the top.</> :
    top - bottom >= 1.3 ? <>A <em>big-game player</em> — his best returns come against the best sides.</> :
    <>No flat-track bias — he scores <em>against everyone</em>.</>
  return (
    <ModuleCard>
      <Kick>Matchup character</Kick>
      <Sentence>{s}</Sentence>
      <Bars>
        {vals.map((v) => (
          <BarRow key={v.label} label={v.label} width={((v.pts as number) / max) * 92} value={(v.pts as number).toFixed(1)} />
        ))}
      </Bars>
      <Support>Average FPL points per game by opponent strength{vals.some((v) => (v.games ?? 9) < 4) ? ' — small samples read with care' : ''}.</Support>
    </ModuleCard>
  )
}
