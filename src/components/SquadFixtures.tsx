import { useMemo } from 'react'
import { FDR_COLORS, teamLabel } from '../lib/util'
import { TeamBadge } from './badges'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   What your fifteen are walking into.

   The Squad Lab already knows which week is the hard one and says so in a
   sentence — "GW6 is the week to plan for, 7 of your 15 walk into a hard
   game". That sentence is the conclusion; this is the working. Fifteen rows,
   six weeks, coloured by the site's own difficulty scale, worst run at the
   top, so the men you have to plan around are the men you read first.

   Sorted by TOTAL difficulty over the window rather than by the worst single
   week: a defender with three fours in a row is a bigger problem than one
   with a five and then five easy ones, and sorting on the peak puts them the
   other way round.

   Blanks are real and drawn as such. A player whose club has no fixture in a
   gameweek scores nothing that week, which is worse than a hard game, so an
   empty cell that looks like "no data" would be actively misleading — it says
   BLANK and counts as a 5 for the ordering.
   ════════════════════════════════════════════════════════════════════════ */

const HARD = 4

export function SquadFixtures({ squad, xi, byEl, fixtureEase, gw, weeks = 6, onPickGw }: {
  squad: number[]
  /** The eleven that starts — a hard run for somebody on your bench is worth
   *  knowing about and worth marking as less urgent. */
  xi: number[]
  byEl: Map<number, RatingRow>
  fixtureEase: FixtureEaseRow[]
  gw: number
  weeks?: number
  onPickGw?: (gw: number) => void
}) {
  const { gws, rows, worst, league } = useMemo(() => {
    const gws = [...new Set(fixtureEase.map((f) => f.gw))].filter((g) => g >= gw).sort((a, b) => a - b).slice(0, weeks)
    /* One pass over the fixture list, not one filter per player per week —
       fifteen players by six weeks over a season of fixtures is 90 scans of
       the whole table otherwise. */
    const by = new Map<string, FixtureEaseRow[]>()
    for (const f of fixtureEase) {
      if (!gws.includes(f.gw)) continue
      const k = `${f.team}|${f.gw}`
      const at = by.get(k)
      if (at) at.push(f)
      else by.set(k, [f])
    }
    const rows = squad.map((el) => {
      const r = byEl.get(el)
      const team = String(r?.team ?? '')
      const cells = gws.map((g) => by.get(`${team}|${g}`) ?? [])
      // A double counts as its easier game: two chances beat one, and the
      // player is more likely to return than a single fixture of that rating.
      const load = cells.reduce((sum, fs) => sum + (fs.length ? Math.min(...fs.map((f) => f.fdr)) : 5), 0)
      return {
        el,
        name: String(r?.web_name ?? ''),
        starter: xi.includes(el),
        cells,
        load,
      }
    })
    rows.sort((a, b) => b.load - a.load || Number(b.starter) - Number(a.starter))

    // Which week has most of the squad in a hard game — the same question the
    // Lab's sentence answers, asked of the same numbers.
    let worst = { gw: gws[0] ?? gw, n: -1 }
    gws.forEach((g, i) => {
      const n = rows.filter((r) => {
        const fs = r.cells[i]
        return !fs.length || Math.min(...fs.map((f) => f.fdr)) >= HARD
      }).length
      if (n > worst.n) worst = { gw: g, n }
    })
    /* AND THE OTHER SEVENTEEN CLUBS. Your fifteen tell you who to bench;
       the league tells you who to buy, and the reader was being sent to a
       different page to find out which clubs the run turns for. Kindest run
       first, because that is the order the question is asked in. */
    const teams = [...new Set(fixtureEase.map((f) => f.team))].sort()
    const mine = new Set(squad.map((el) => String(byEl.get(el)?.team ?? '')))
    const league = teams.map((t) => {
      const cells = gws.map((g) => by.get(`${t}|${g}`) ?? [])
      const load = cells.reduce((sum, fs) => sum + (fs.length ? Math.min(...fs.map((f) => f.fdr)) : 5), 0)
      return { team: t, owned: mine.has(t), cells, load }
    })
    league.sort((a, b) => a.load - b.load || a.team.localeCompare(b.team))

    return { gws, rows, worst, league }
  }, [squad, xi, byEl, fixtureEase, gw, weeks])

  if (!gws.length || !rows.length) return null

  return (
    <div>
      <div className="mb-2 rounded-lg border border-line bg-surface-1/60 px-3 py-2 text-[12.5px] leading-snug text-ink-2">
        {worst.n === 0 ? (
          <>Nothing hard in the next {gws.length} weeks — <span className="font-semibold text-good">not one of your fifteen</span> meets a fixture rated 4 or 5.</>
        ) : (
          <><span className="font-semibold text-ink">GW{worst.gw} is the week to plan for</span> — {worst.n} of your {rows.length} walk
            into a fixture rated 4 or 5, or a blank.</>
        )}
      </div>

      {/* A grid rather than a table: every row is the same six columns, and a
          table's cell padding at this size costs more than the fixtures do. */}
      <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="min-w-[300px]">
          <div className="mb-1 grid gap-1" style={{ gridTemplateColumns: `72px repeat(${gws.length}, minmax(0,1fr))` }}>
            <span />
            {gws.map((g) => (
              <button
                key={g}
                onClick={onPickGw ? () => onPickGw(g) : undefined}
                title={onPickGw ? `Take the board to gameweek ${g}` : undefined}
                className={`text-center text-[9.5px] font-bold tracking-[0.06em] uppercase ${
                  g === gw ? 'text-accent' : 'text-ink-3'} ${onPickGw ? 'hover:text-ink' : ''}`}
              >
                GW{g}
              </button>
            ))}
          </div>
          {rows.map((r) => (
            <div
              key={r.el}
              className="mb-1 grid items-center gap-1"
              style={{ gridTemplateColumns: `72px repeat(${gws.length}, minmax(0,1fr))` }}
            >
              <span className={`truncate text-[11px] ${r.starter ? 'text-ink' : 'text-ink-3'}`} title={r.starter ? r.name : `${r.name} — on your bench`}>
                {r.name}
              </span>
              {r.cells.map((fs, i) => {
                if (!fs.length) {
                  return (
                    <span key={gws[i]} className="rounded border border-dashed border-line-strong py-[3px] text-center text-[8.5px] font-bold text-ink-3">
                      BLANK
                    </span>
                  )
                }
                const f = fs.reduce((a, b) => (a.fdr <= b.fdr ? a : b))
                const [bg, fg] = FDR_COLORS[f.fdr] ?? FDR_COLORS[3]
                return (
                  <span
                    key={gws[i]}
                    title={`GW${gws[i]} — ${f.opponent} ${f.venue === 'H' ? 'at home' : 'away'}, difficulty ${f.fdr}${fs.length > 1 ? ` (double: ${fs.map((x) => x.opponent).join(', ')})` : ''}`}
                    className="rounded py-[3px] text-center text-[9px] font-bold"
                    style={{ background: bg, color: fg }}
                  >
                    {f.opponent}{fs.length > 1 ? '+' : ''}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-ink-3">
        Hardest run first, on the site's own difficulty scale. Grey names are on your bench.
        A double shows its easier game with a +; a blank gameweek counts as a 5.
      </p>

      <div className="mt-4 mb-2 flex items-baseline gap-2">
        <h4 className="text-[11px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">Every club</h4>
        <span className="text-[11px] text-ink-3">kindest run first</span>
      </div>
      <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="min-w-[300px]">
          <div className="mb-1 grid gap-1" style={{ gridTemplateColumns: `72px repeat(${gws.length}, minmax(0,1fr))` }}>
            <span />
            {gws.map((g) => (
              <span key={g} className={`text-center text-[9.5px] font-bold tracking-[0.06em] uppercase ${g === gw ? 'text-accent' : 'text-ink-3'}`}>
                GW{g}
              </span>
            ))}
          </div>
          {league.map((t) => (
            <div
              key={t.team}
              className="mb-1 grid items-center gap-1"
              style={{ gridTemplateColumns: `72px repeat(${gws.length}, minmax(0,1fr))` }}
            >
              <span className="flex min-w-0 items-center gap-1.5" title={`${teamLabel(t.team)}${t.owned ? ' — you own a player here' : ''}`}>
                <TeamBadge team={t.team} size={14} />
                <span className={`truncate text-[11px] font-semibold ${t.owned ? 'text-accent-2' : 'text-ink-3'}`}>{t.team}</span>
              </span>
              {t.cells.map((fs, i) => {
                if (!fs.length) {
                  return (
                    <span key={gws[i]} className="rounded border border-dashed border-line-strong py-[3px] text-center text-[8.5px] font-bold text-ink-3">
                      BLANK
                    </span>
                  )
                }
                const f = fs.reduce((a, b) => (a.fdr <= b.fdr ? a : b))
                const [bg, fg] = FDR_COLORS[f.fdr] ?? FDR_COLORS[3]
                return (
                  <span
                    key={gws[i]}
                    title={`GW${gws[i]} — ${f.opponent} ${f.venue === 'H' ? 'at home' : 'away'}, difficulty ${f.fdr}${fs.length > 1 ? ` (double: ${fs.map((x) => x.opponent).join(', ')})` : ''}`}
                    className="rounded py-[3px] text-center text-[9px] font-bold"
                    style={{ background: bg, color: fg }}
                  >
                    {f.opponent}{fs.length > 1 ? '+' : ''}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-ink-3">
        Every club in the game over the same weeks. Gold codes are clubs you already hold.
      </p>
    </div>
  )
}
