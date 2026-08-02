import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { TeamBadge } from './badges'
import { matchSquad, squadProblems, normName, levenshtein, type SlotMatch } from '../lib/squadMatch'
import { validXI } from '../lib/planner'
import { readSquadScreenshot, type ShotCard } from '../lib/squadShot'
import { teamLabel } from '../lib/util'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/**
 * Load a squad from a screenshot of the FPL app.
 *
 * Typing fifteen names into the builder is the whole reason people don't use
 * it with their own team, and the FPL API can't be called from a static site
 * without a manager ID and a CORS proxy. A screenshot is the one thing every
 * manager already has.
 *
 * The reader is good but it is not certain, and the honest design follows from
 * that: it never applies a squad without showing what it thinks it read. Every
 * slot names the player it matched, marks how confident it is, and can be
 * changed; the button that commits stays disabled until fifteen places have
 * someone in them.
 */

const ROW_LABEL = ['Goalkeeper', 'Defenders', 'Midfielders', 'Forwards', 'Bench']

type Stage = 'pick' | 'reading' | 'confirm'

/** The squad, and the way the picture had it set out. */
export interface ImportedSquad {
  /** All fifteen, in pitch reading order. */
  squad: number[]
  /** The starting eleven and the bench, when the picture said which was which. */
  lineup: { xi: number[]; bench: number[] } | null
}

export function SquadImport({ pool, fixtureEase, gw, onApply, onClose }: {
  pool: RatingRow[]
  fixtureEase: FixtureEaseRow[]
  gw: number
  onApply: (imported: ImportedSquad) => void
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>('pick')
  const [progress, setProgress] = useState<{ text: string; pct: number }>({ text: '', pct: 0 })
  const [error, setError] = useState<string | null>(null)
  const [slots, setSlots] = useState<SlotMatch[]>([])
  const [picks, setPicks] = useState<(RatingRow | null)[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const run = async (file: File) => {
    setError(null)
    setStage('reading')
    setProgress({ text: 'Opening the picture', pct: 1 })
    try {
      const read = await readSquadScreenshot(file, (text, pct) => setProgress({ text, pct }))
      const matched = matchSquad(read.cards as ShotCard[], read.rowCount, pool, fixtureEase, gw)
      setSlots(matched)
      setPicks(matched.map((m) => m.player))
      setStage('confirm')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That picture could not be read.')
      setStage('pick')
    }
  }

  const problems = useMemo(() => squadProblems(picks), [picks])
  const filled = picks.filter(Boolean).length
  const spend = picks.reduce((s, p) => s + (p ? Number(p.price) || 0 : 0), 0)
  // Fifteen places filled and a legal squad: anything less and the builder
  // would take a shape it cannot represent.
  const canApply = filled === 15 && problems.length === 0

  const byRow = useMemo(() => {
    const m = new Map<number, number[]>()
    slots.forEach((s, i) => { const a = m.get(s.row) ?? []; a.push(i); m.set(s.row, a) })
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [slots])
  const rowCount = byRow.length

  /* Who starts, taken from where they stood on the pitch.
   *
   * Without this the builder was handed fifteen names in a heap and picked its
   * own best-rated legal eleven, which put a reader's benched player in the
   * side. The picture already says it: the last row is the bench and the four
   * above it are the eleven. That is not a suggestion to be improved on — it
   * is the team the reader picked, and the whole point of importing it.
   *
   * One difference in convention. The FPL app draws the reserve keeper first
   * on its bench; here the bench is ordered by substitution priority, so the
   * keeper goes last and the three outfield reserves keep the order the app
   * drew them in. */
  const lineup = useMemo(() => {
    if (rowCount !== 5 || picks.length !== 15 || picks.some((p) => !p)) return null
    const el = (i: number) => Number((picks[i] as RatingRow).element)
    const xi = byRow.slice(0, 4).flatMap(([, idxs]) => idxs.map(el))
    const benchRow = byRow[4][1].map(el)
    if (xi.length !== 11 || benchRow.length !== 4) return null
    const posOf = (e: number) => String(picks.find((p) => Number(p?.element) === e)?.position ?? '')
    // A shape our own position data says is illegal means we read a row wrong
    // or disagree with FPL about someone's position. Better to hand back
    // nothing and let the builder auto-pick than to store a broken eleven.
    if (!validXI(xi, posOf as never)) return null
    const gk = benchRow.filter((e) => posOf(e) === 'GKP')
    const out = benchRow.filter((e) => posOf(e) !== 'GKP')
    if (gk.length !== 1) return null
    return { xi, bench: [...out, ...gk] }
  }, [byRow, picks, rowCount])

  return createPortal(
    <div className="fixed inset-0 z-[220] grid place-items-center bg-black/70 p-3 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="Load a squad from a screenshot"
        className="flex max-h-[90dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-line-mid bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-extrabold tracking-[-0.01em] text-ink">Load your squad from a screenshot</div>
            <div className="text-[12.5px] text-ink-2">
              {stage === 'confirm' ? 'Check each name, change any it got wrong.' : 'Screenshot the Pick Team screen in the FPL app.'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {stage === 'pick' && (
            <>
              <ol className="mb-4 flex flex-col gap-2 text-[13.5px] text-ink-2">
                {[
                  'Open the Fantasy Premier League app and go to Pick Team.',
                  'Take a screenshot of the pitch — the whole fifteen, with a name and a fixture under each player.',
                  'Choose that screenshot below.',
                ].map((t, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-extrabold text-accent">{i + 1}</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
              {error && (
                <div className="mb-3 rounded-xl border border-bad/40 bg-bad/10 p-3 text-[13px] text-ink">{error}</div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.currentTarget.value = '' }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent bg-accent-soft px-4 py-3 text-[14px] font-bold text-accent transition-colors hover:brightness-110"
              >
                <Icon name="camera" size={16} /> Choose a screenshot
              </button>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
                The picture is read on your own device and never leaves it — there is no upload. The first read downloads
                the text recogniser, which is a few megabytes; after that it is kept on the device.
              </p>
            </>
          )}

          {stage === 'reading' && (
            <div className="py-10 text-center">
              <div className="mx-auto mb-4 h-1.5 w-56 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(4, progress.pct)}%` }} />
              </div>
              <div className="text-[14px] font-semibold text-ink">{progress.text}…</div>
              <div className="mt-1 text-[12.5px] text-ink-3">This takes a few seconds the first time.</div>
            </div>
          )}

          {stage === 'confirm' && (
            <>
              {byRow.map(([row, idxs]) => (
                <div key={row} className="mb-3">
                  <div className="mb-1.5 text-[10px] font-bold tracking-[0.14em] text-ink-3 uppercase">
                    {rowCount === 5 ? ROW_LABEL[row] : `Row ${row + 1}`}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {idxs.map((i) => (
                      <SlotRow
                        key={i}
                        slot={slots[i]}
                        player={picks[i]}
                        pool={pool}
                        open={editing === i}
                        onToggle={() => setEditing(editing === i ? null : i)}
                        onPick={(p) => { setPicks((v) => v.map((x, j) => (j === i ? p : x))); setEditing(null) }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {problems.length > 0 && (
                <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3">
                  <div className="mb-1 text-[11px] font-bold tracking-[0.1em] text-ink-2 uppercase">Not a legal squad yet</div>
                  <ul className="flex flex-col gap-0.5 text-[12.5px] text-ink-2">
                    {problems.map((p) => <li key={p}>· {p}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {stage === 'confirm' && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <div className="text-[12.5px] text-ink-2">
              <span className="font-bold text-ink">{filled}/15</span> found · £{spend.toFixed(1)}m
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setStage('pick'); setSlots([]); setPicks([]) }} className="min-h-9 rounded-lg border border-line-mid px-3 text-[13px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
                Try another picture
              </button>
              <button
                disabled={!canApply}
                onClick={() => onApply({ squad: (picks.filter(Boolean) as RatingRow[]).map((p) => Number(p.element)), lineup })}
                className="min-h-9 rounded-lg border border-accent bg-accent-soft px-4 text-[13px] font-bold text-accent transition-colors enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:border-line-mid disabled:bg-transparent disabled:text-ink-3"
              >
                Use this squad
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** One place on the pitch: what the reader saw, who it matched, and a picker. */
function SlotRow({ slot, player, pool, open, onToggle, onPick }: {
  slot: SlotMatch
  player: RatingRow | null
  pool: RatingRow[]
  open: boolean
  onToggle: () => void
  onPick: (p: RatingRow | null) => void
}) {
  const [query, setQuery] = useState('')
  /* Three states worth telling apart, and the middle one deserves a reason.
   * An exact name inside the club the fixture named is as certain as this
   * gets. A fuzzy name is probably right but is the first place to look when
   * something is off. A name matched outside its club means the screenshot
   * and our data disagree about where he plays — nearly always a transfer the
   * daily feed hasn't caught, and worth saying so rather than a bare warning. */
  const sure = !!player && (slot.distance === 0 || slot.clear) && (slot.how === 'club+pos' || slot.how === 'club')
  const flag = !player
    ? null
    : slot.how === 'name'
      ? { text: 'club differs', why: slot.club ? `The screenshot has him playing for ${teamLabel(slot.club)}; our data has ${teamLabel(String(player.team))}.` : 'Matched on name alone.' }
      : sure
        ? null
        : { text: 'check', why: `The name read as "${slot.read}", and more than one ${slot.club ? teamLabel(slot.club) : ''} player is close to it.`.replace('  ', ' ') }
  const tone = !player ? 'border-bad/50 bg-bad/8' : sure ? 'border-line' : 'border-warn/45 bg-warn/8'

  const options = useMemo(() => {
    const q = query.trim()
    if (!q) return slot.alternatives.slice(0, 12)
    const n = normName(q)
    return pool
      .map((p) => ({ p, d: levenshtein(n, normName(String(p.web_name))) }))
      .filter((x) => normName(String(x.p.web_name)).includes(n) || x.d <= 2)
      .sort((a, b) => a.d - b.d)
      .slice(0, 12)
      .map((x) => x.p)
  }, [query, slot.alternatives, pool])

  return (
    <div className={`rounded-xl border ${tone}`}>
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left">
        <span className="shrink-0">
          {player ? <TeamBadge team={String(player.team)} size={20} /> : <Icon name="alert" size={18} className="text-bad" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[14px] font-bold text-ink">{player ? String(player.web_name) : 'Not recognised'}</span>
            {flag && (
              <span title={flag.why} className="shrink-0 rounded-full bg-warn/20 px-1.5 py-px text-[9.5px] font-bold tracking-[0.04em] text-warn uppercase">
                {flag.text}
              </span>
            )}
          </span>
          <span className="block truncate text-[11.5px] text-ink-3">
            {player ? `${player.position} · ${teamLabel(String(player.team))} · £${(Number(player.price) || 0).toFixed(1)}m` : 'Tap to choose the player'}
          </span>
        </span>
        {/* What the reader actually saw, so a wrong match is explicable rather
            than mysterious. It costs about 85px, which a 320px screen does not
            have to spare once a warning chip is in the row — there the name
            itself was truncating, and the name is the thing being checked. */}
        <span className="hidden shrink-0 text-right min-[360px]:block">
          <span className="block font-mono text-[11px] text-ink-3">{slot.read || '—'}</span>
          <span className="block font-mono text-[11px] text-ink-3">{slot.fixture || '—'}</span>
        </span>
        <Icon name={open ? 'chevron-left' : 'chevron-right'} size={14} className="shrink-0 text-ink-3" />
      </button>
      {open && (
        <div className="border-t border-line px-2.5 py-2">
          <div className="mb-2 text-[12px] text-ink-3 min-[360px]:hidden">
            Read as <span className="font-mono text-ink-2">{slot.read || '—'}</span> · <span className="font-mono text-ink-2">{slot.fixture || '—'}</span>
          </div>
          {flag && <div className="mb-2 text-[12px] leading-relaxed text-ink-2">{flag.why}</div>}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={slot.club ? `Search — ${teamLabel(slot.club)} shown first` : 'Search all players'}
            className="mb-2 w-full rounded-lg border border-line-mid bg-bg-0 px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          />
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto overscroll-contain">
            {options.map((p) => (
              <button
                key={p.element}
                onClick={() => onPick(p)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <TeamBadge team={String(p.team)} size={16} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{String(p.web_name)}</span>
                <span className="shrink-0 text-[11.5px] text-ink-3">{p.position} · £{(Number(p.price) || 0).toFixed(1)}m</span>
              </button>
            ))}
            {!options.length && <div className="px-2 py-2 text-[12.5px] text-ink-3">No player of that name.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
