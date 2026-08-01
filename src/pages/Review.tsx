import { PageShell } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { Icon, type IconName } from '../components/Icon'
import { useSeason } from '../lib/season'

// GW Review — the look-back page. It reads a gameweek that has been played, so
// there is nothing for it to read until one has been, and it lands whenever the
// last fixture finishes rather than on a fixed day: gameweeks run Friday to
// Monday, and Cup weeks and postponements move them again. Pre-season it says
// so in the same words as My Team; the sections below are what it will be.

interface Planned { icon: IconName; title: string; desc: string }
const PLANNED: Planned[] = [
  {
    icon: 'trophy',
    title: 'Team of the Week',
    desc: 'The eleven that actually returned, on the pitch, with the hauls that got them there.',
  },
  {
    icon: 'crown',
    title: 'The captain call',
    desc: 'Who the armband should have gone to, what the popular pick cost, and whether the right call was right for the right reason.',
  },
  {
    icon: 'trend-up',
    title: 'Rode their luck, or didn’t',
    desc: 'Points against expected goals: who overshot the underlying numbers and who is owed a haul.',
  },
  {
    icon: 'eye',
    title: 'Where the model missed',
    desc: 'The ratings that got it wrong, published rather than quietly forgotten — the only honest way to earn the ones that get it right.',
  },
  {
    icon: 'users',
    title: 'What the crowd did',
    desc: 'Ownership swings, the transfers that paid, and the bandwagons worth catching late.',
  },
  {
    icon: 'calendar',
    title: 'Into the next one',
    desc: 'What the gameweek changed about the fixtures ahead, handed straight to the GW Preview.',
  },
]

export default function Review() {
  const { info } = useSeason()
  const preseason = Boolean(info?.provisional)
  const season = info?.label ?? 'new'

  return (
    <PageShell>
      <SectionBanner
        imgKey="review"
        title="GW Review"
        subtitle="What the gameweek actually did — hauls, captain calls and where the model missed"
      />

      <div className="rounded-2xl border border-line bg-surface-1/60 p-6 text-center md:p-10">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
          <Icon name="clock" size={22} />
        </div>
        <div className="mb-1 text-lg font-bold text-ink">Available after Gameweek 1</div>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-ink-2">
          {preseason ? (
            <>
              GW Review looks back at a gameweek that has been played, so it switches on once the {season} season kicks
              off and gameweek 1 is done. Until then, the GW Preview has the week ahead and Fixtures has the run after
              it.
            </>
          ) : (
            <>
              The first review lands after gameweek 1 is complete. The GW Preview has the week ahead in the meantime.
            </>
          )}
        </p>
      </div>

      <h2 className="mt-8 mb-1 text-[11px] font-bold tracking-[0.18em] text-ink-3 uppercase">What it will cover</h2>
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-ink-2">
        Once the gameweek is done, it gets read back through the same numbers the ratings are built on.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLANNED.map((p) => (
          <div key={p.title} className="rounded-xl border border-line bg-surface-1/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                <Icon name={p.icon} size={16} />
              </span>
              <div className="text-sm font-bold text-ink">{p.title}</div>
            </div>
            <p className="text-[13px] leading-relaxed text-ink-2">{p.desc}</p>
          </div>
        ))}
      </div>
    </PageShell>
  )
}
