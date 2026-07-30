import { useState } from 'react'
import { PageShell } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { Tabs, type TabDef } from '../components/Tabs'
import { Icon } from '../components/Icon'
import { PHOTO_CREDITS, DATA_SOURCES, LICENCE_URL, NEEDS_ATTRIBUTION, SHARE_ALIKE } from '../lib/credits'
import { usesOwnRelay } from '../lib/api'

/* ════════════════════════════════════════════════════════════════════════
   LEGAL — credits, data sources, terms and privacy on one page.

   Attribution licences require the credit to be reachable by whoever sees
   the image, which a repo README is not. Everything a visitor might need to
   check is therefore here, linked from the footer of every page.

   The Terms and Privacy wording is written from what the site actually does,
   by hand rather than from a generator: where the site has a legal
   consequence (an FPL team ID leaving the browser, preferences stored on
   device) the text says so plainly rather than hiding behind boilerplate.
   That is what makes it worth publishing — and it is also why it has to be
   kept honest. If the behaviour changes, this page changes with it, and
   LAST_UPDATED moves. It has not been reviewed by a solicitor.
   ════════════════════════════════════════════════════════════════════════ */

const TABS: TabDef[] = [
  { id: 'about', label: 'About the data', icon: <Icon name="info" size={13} /> },
  { id: 'credits', label: 'Photo credits', icon: <Icon name="eye" size={13} /> },
  { id: 'terms', label: 'Terms of use', icon: <Icon name="check" size={13} /> },
  { id: 'privacy', label: 'Privacy', icon: <Icon name="shield" size={13} /> },
]

export default function Legal() {
  const [tab, setTab] = useState('about')
  return (
    <PageShell>
      <SectionBanner imgKey="teams" title="Legal" subtitle="Where the data comes from, who took the photographs, and what this site does with your information" />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="mt-5 max-w-3xl">
        {tab === 'about' && <About />}
        {tab === 'credits' && <Credits />}
        {tab === 'terms' && <Terms />}
        {tab === 'privacy' && <Privacy />}
      </div>
    </PageShell>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-7 mb-2 text-[15px] font-extrabold tracking-wide text-ink uppercase first:mt-0">{children}</h2>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[14.5px] leading-relaxed text-ink-2">{children}</p>
}
/** The address a visitor writes to.
 *
 *  Named once, and deliberately not a personal address: a privacy notice has
 *  to publish somewhere a reader can reach, and that page is indexed forever.
 *  A role address keeps the obligation met without putting the person behind
 *  the site into a search result. */
const CONTACT_EMAIL = 'fpl.analyser1@gmail.com'

/** A mail or web link in the body copy — same underline as the credits. */
function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-accent underline underline-offset-2 hover:text-accent-2">
      {children}
    </a>
  )
}

/** When the Terms and Privacy wording last changed.
 *
 *  A privacy notice without a date is one a reader cannot check. It tells
 *  someone who read it six months ago whether it is worth reading again, and
 *  it is the first thing anyone auditing the page looks for. Bump it whenever
 *  the wording below changes in substance — not for a typo. */
const LAST_UPDATED = '30 July 2026'

function Updated() {
  return <p className="mb-5 text-[13px] text-ink-3">Last updated {LAST_UPDATED}.</p>
}

function About() {
  return (
    <>
      <H>What this site is</H>
      <P>
        FPL Analyser rates Premier League players on the numbers that predict Fantasy Premier League
        returns, and turns them into plain-language reads. It is an independent site. It is not
        affiliated with, endorsed by or connected to the Premier League, Fantasy Premier League,
        or any club.
      </P>

      <H>Where the numbers come from</H>
      <P>
        Ratings, projections and fixture difficulty are our own work, calculated from the sources
        below. Every figure is a model output, not a fact about the future.
      </P>
      <div className="overflow-hidden rounded-xl border border-line">
        {DATA_SOURCES.map((s) => (
          <div key={s.name} className="border-b border-line px-4 py-3 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-[14px] text-ink">{s.name}</b>
              {s.sendsVisitorData && (
                <span className="rounded bg-warn/25 px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wide text-warn uppercase">
                  Leaves your browser
                </span>
              )}
            </div>
            <div className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{s.what}</div>
            {s.url && (
              <a href={s.url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-[12.5px] text-accent underline">
                {s.url}
              </a>
            )}
          </div>
        ))}
      </div>

      <H>Accuracy</H>
      <P>
        The data is refreshed daily and can be wrong or out of date — a price change, an injury or a
        team sheet can land after the last refresh. Nothing here is betting advice or a guarantee of
        any FPL outcome. Check anything that matters against the official FPL site before acting.
      </P>
    </>
  )
}

function Credits() {
  const needed = PHOTO_CREDITS.filter((c) => NEEDS_ATTRIBUTION.has(c.licence))
  const shareAlike = PHOTO_CREDITS.filter((c) => SHARE_ALIKE.has(c.licence))
  return (
    <>
      <H>Photographs</H>
      <P>
        Every photograph on the site, with its author and licence. Images are cropped and compressed
        for layout; nothing else is altered.
      </P>
      <div className="overflow-hidden rounded-xl border border-line">
        {PHOTO_CREDITS.map((c) => (
          <div key={c.file} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line px-4 py-2.5 text-[13.5px] last:border-0">
            <b className="text-ink">{c.subject}</b>
            <span className="text-ink-3">by</span>
            <span className="text-ink">{c.author}</span>
            <a
              href={LICENCE_URL[c.licence] ?? '#'}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto shrink-0 rounded border border-line-mid px-1.5 py-0.5 text-[11px] font-semibold text-ink-2 hover:border-line-strong"
            >
              {c.licence}
            </a>
            {c.source && (
              <a href={c.source} target="_blank" rel="noreferrer noopener" className="w-full text-[12px] text-accent underline">
                {c.source}
              </a>
            )}
          </div>
        ))}
      </div>
      {shareAlike.length > 0 && (
        <>
          <H>Share-alike</H>
          <P>
            {shareAlike.length} of these are licensed share-alike. Our cropped versions of those
            images are therefore offered under the same licence as the originals, and anyone may
            reuse them on the same terms.
          </P>
        </>
      )}
      {needed.length === 0 && (
        <P>
          None of the current photographs carry a licence that legally requires attribution — they
          are credited anyway.
        </P>
      )}

      <H>Crests and headshots</H>
      <P>
        Club crests and player headshots are loaded from the Premier League’s own image servers and
        remain the property of their owners. They are used here to identify clubs and players.
      </P>
    </>
  )
}

function Terms() {
  return (
    <>
      <Updated />

      <H>1. Who we are</H>
      <P>
        FPL Analyser is an independent site run from the United Kingdom. Contact:{' '}
        <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>.
      </P>

      <H>2. Using the site</H>
      <P>
        You may use the site for your own personal, non-commercial Fantasy Premier League research.
        You may share individual screenshots and the export images the site generates. You may not
        scrape the site or republish the ratings and projections in bulk as your own.
      </P>

      <H>3. No guarantees</H>
      <P>
        Everything here is a model output and opinion, offered as-is. Ratings, expected points,
        fixture difficulty and suggested transfers are estimates that will often be wrong. Nothing on
        the site is financial, betting or professional advice. Decisions you take with your FPL team
        are yours alone, and we accept no liability for them. Nothing in these terms limits liability
        for death or personal injury caused by negligence, or for fraud.
      </P>

      <H>4. Availability</H>
      <P>
        The site is provided free and may be changed, interrupted or withdrawn at any time. Data
        refreshes depend on third-party sources that can fail.
      </P>

      <H>5. Trade marks</H>
      <P>
        Premier League, club names and crests are the trade marks of their owners. This site is not
        affiliated with, endorsed by or connected to the Premier League, Fantasy Premier League, or
        any club.
      </P>

      <H>6. Our content</H>
      <P>
        The ratings, models, wording and design are ours. Photographs belong to their photographers
        and are used under the licences listed on the Photo credits tab.
      </P>

      <H>7. Governing law</H>
      <P>These terms are governed by the law of England and Wales.</P>
    </>
  )
}

function Privacy() {
  return (
    <>
      <Updated />

      <H>The short version</H>
      <P>
        There is no account, no login and no advertising. We do not run analytics or tracking. We do
        not set cookies. We do not sell or share anything about you.
      </P>

      <H>What is stored on your device</H>
      <P>
        The site saves a few preferences in your browser’s local storage so it behaves the way you
        left it: your theme and accent colour, the season you are viewing, whether you have seen the
        intro, your saved squad plan, and — if you enter one — your FPL team ID. This never leaves
        your device except as described below. Clearing your browser storage removes all of it.
      </P>

      <H>When something does leave your browser</H>
      <P>
        Two things reach a third party, and only these:
      </P>
      {/* The wording follows the build: once VITE_FPL_PROXY points at our own
          Worker there is no third party to disclose, and claiming otherwise
          would be as wrong as hiding it. */}
      {usesOwnRelay ? (
        <P>
          <b className="text-ink">Your FPL team ID</b>, if you enter one on My Team. The Fantasy
          Premier League API cannot be called from a web page directly, so the request goes through
          a relay we run ourselves. It passes the request straight to FPL and hands back the answer;
          it keeps no record of who asked. No other company is involved.
        </P>
      ) : (
        <P>
          <b className="text-ink">Your FPL team ID</b>, if you enter one on My Team. The Fantasy
          Premier League API cannot be called from a web page directly, so the request is relayed
          through a public CORS service. Your team ID, and the squad, manager name and league names
          that come back, pass through that relay. If you would rather that did not happen, do not
          use My Team — the rest of the site works without it.
        </P>
      )}
      <P>
        <b className="text-ink">Your IP address</b>, to the Premier League’s image servers, because
        your browser loads club crests and player headshots from them, and to GitHub Pages, which
        hosts the site and keeps standard server logs.
      </P>

      <H>Legal basis and your rights</H>
      <P>
        The preferences stored on your device are there because you asked for them by using the site,
        and are strictly necessary for the features you chose. We hold no database of users, so there
        is nothing for us to look up, correct or delete on request — but you can remove everything
        yourself by clearing your browser storage. If you have a question, write to{' '}
        <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>. You can complain to the Information
        Commissioner’s Office at ico.org.uk.
      </P>

      <H>If you support the site</H>
      <P>
        The site is free. If there is a tip link, it is an ordinary link to a
        payment provider — there is no widget, script or tracker from them on any page
        here, so nothing about you reaches them unless you choose to click through. From
        that point their own privacy policy applies, and we never see your card details.
        We do not receive, store or match your name or email to anything on this site.
      </P>

      <H>Children</H>
      <P>
        The site is aimed at adults playing Fantasy Premier League. It collects nothing that would
        identify a child.
      </P>
    </>
  )
}
