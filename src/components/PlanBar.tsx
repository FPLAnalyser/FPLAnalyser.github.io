import { useState } from 'react'
import { Icon } from './Icon'
import { agoOf, MAX_PLANS, type Plans } from '../lib/plans'

/* ════════════════════════════════════════════════════════════════════════
   The plan library, as a strip.

   Cards were the obvious shape and the wrong one: on a phone three cards is
   most of a screen before you have seen the pitch, and the library is not
   the thing you came to look at. So it is a row of chips that scrolls, with
   the actions on the active one only — the plan you are editing is the plan
   whose name you might want to change.

   Duplicate is the primary action, not New. Nobody builds a second squad
   from an empty pitch; they build one, wonder about a single decision, and
   want to change it without losing the original.
   ════════════════════════════════════════════════════════════════════════ */

export function PlanBar({ plans, canCompare, onCompare }: {
  plans: Plans
  /** True once two or more are ticked — the button that jumps to Insights. */
  canCompare: boolean
  onCompare: () => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  if (!plans.plans.length) return null

  const startRename = (id: string, name: string) => { setRenaming(id); setDraft(name); setConfirmDel(null) }
  const commit = () => {
    if (renaming) plans.rename(renaming, draft.trim())
    setRenaming(null)
  }

  return (
    <div className="mb-3 rounded-xl border border-line bg-surface-1/60 p-2">
      {/* One header line, not two. The count and the instruction say different
          things and both are short, so they share a row; the rest of what the
          paragraph under here used to say is on the label as a title. */}
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className="text-[10px] font-bold tracking-[0.14em] text-ink-3 uppercase"
          title="Plans live in this browser only — no account, and nothing leaves the device."
        >Plans</span>
        <span className="text-[11px] text-ink-3">{plans.plans.length} of {MAX_PLANS}</span>
        <span className="text-[11px] text-ink-3">· tick two or more, then Compare</span>
        {canCompare && (
          <button
            onClick={onCompare}
            className="ml-auto inline-flex min-h-8 items-center gap-1.5 self-center rounded-lg bg-accent px-3 text-[12px] font-bold text-accent-contrast transition-colors hover:bg-accent-strong"
          >
            <Icon name="users" size={13} /> Compare
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {plans.plans.map((p) => {
          const active = p.id === plans.activeId
          const ticked = plans.compare.includes(p.id)
          return (
            <div
              key={p.id}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                active ? 'border-accent bg-accent-selected' : 'border-line-mid bg-surface-2'}`}
            >
              {/* Ticking a plan for comparison must not also open it — those
                  are different intentions and merging them means you cannot
                  compare two plans without leaving the one you are editing. */}
              <button
                onClick={() => plans.toggleCompare(p.id)}
                aria-pressed={ticked}
                title={ticked ? 'Remove from comparison' : 'Add to comparison'}
                className={`flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
                  ticked ? 'border-accent bg-accent text-accent-contrast' : 'border-line-strong text-transparent'}`}
              >
                <Icon name="check" size={11} />
              </button>

              {renaming === p.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setRenaming(null) }}
                  className="w-28 rounded border border-accent bg-surface-1 px-1.5 py-0.5 text-[13px] text-ink outline-none"
                />
              ) : (
                <button
                  onClick={() => plans.setActive(p.id)}
                  className="min-h-7 text-left"
                >
                  <span className={`block text-[13px] font-semibold whitespace-nowrap ${active ? 'text-accent' : 'text-ink'}`}>
                    {p.name}
                  </span>
                  <span className="font-num block text-[10px] whitespace-nowrap text-ink-3 tabular-nums">
                    {p.base.length}/15 · {agoOf(p.updated)}
                  </span>
                </button>
              )}

              {/* Glyphs, not words. "Rename" and "Duplicate" spelled out ran
                  110px of type on the one chip you are already looking at,
                  which is what pushed this strip wide enough to need the whole
                  page. Both keep their name in a tooltip and an aria-label —
                  the icon is the shorthand, not the only telling. Delete is
                  the exception in reverse: it stays a two-step, because an
                  icon you can hit by accident should not remove a plan. */}
              {active && renaming !== p.id && (
                <span className="flex items-center gap-0.5 border-l border-line pl-1">
                  <IconBtn name="pencil" label="Rename this plan" onClick={() => startRename(p.id, p.name)} />
                  <IconBtn
                    name="copy"
                    label={plans.full ? `${MAX_PLANS} plans is the limit` : 'Duplicate this plan'}
                    disabled={plans.full}
                    onClick={() => plans.duplicate(p.id)}
                  />
                  {confirmDel === p.id ? (
                    <button
                      onClick={() => { plans.remove(p.id); setConfirmDel(null) }}
                      className="min-h-7 rounded px-1.5 text-[11px] font-bold text-bad"
                    >
                      Delete it?
                    </button>
                  ) : (
                    <IconBtn
                      name="x"
                      label={plans.plans.length < 2 ? 'The last plan stays' : 'Delete this plan'}
                      disabled={plans.plans.length < 2}
                      danger
                      onClick={() => setConfirmDel(p.id)}
                    />
                  )}
                </span>
              )}
            </div>
          )
        })}

        <button
          onClick={() => plans.create(`Plan ${plans.plans.length + 1}`, [])}
          disabled={plans.full}
          title={plans.full ? `${MAX_PLANS} is the limit` : 'Start an empty fifteen'}
          className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 text-[12.5px] font-semibold text-ink-2 transition-colors hover:text-ink disabled:opacity-40"
        >
          <span aria-hidden="true">+</span> New
        </button>
      </div>

    </div>
  )
}

function IconBtn({ name, label, onClick, disabled, danger }: {
  name: 'pencil' | 'copy' | 'x'; label: string; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex size-7 items-center justify-center rounded text-ink-3 transition-colors disabled:opacity-30 ${
        danger ? 'hover:text-bad' : 'hover:text-ink'}`}
    >
      <Icon name={name} size={13} />
    </button>
  )
}
