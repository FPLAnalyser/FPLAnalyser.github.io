// The guard that stands between the data and a published post.
//
// docs/DOMAIN_CATEGORISATION.md is explicit that a crawler finding
// "clean-sheet odds" on the site is the plausible route to a **Gambling**
// classification, which is blocked far harder and in far more places than
// being uncategorised. The site keeps those words out of its own copy; a post
// has to clear the same bar and then some, because a page can be edited after
// publishing and a post that has been seen cannot be unseen.
//
// The generator reads `odds.json` for nothing, but half the numbers it does
// read are downstream of market-implied probabilities, so a phrasing that
// explains where a figure comes from is one plausible sentence away from
// naming the input. This is a hard failure, not a warning: the drafting job
// exits non-zero rather than open an issue containing a word that could cost
// the domain its classification.

/** Words that must never reach a post. Matched whole, case-insensitively. */
const BANNED = [
  'odds', 'bookmaker', 'bookmakers', 'bookie', 'bookies', 'betting', 'bet',
  'bets', 'wager', 'wagers', 'accumulator', 'acca', 'punt', 'punter',
  'stake', 'stakes', 'gamble', 'gambling', 'parlay',
]

/**
 * Names and addresses the site is published without. CLAUDE.md notes this has
 * slipped through twice already in non-user-facing default paths, and a social
 * post is the least recoverable place for it to slip through a third time.
 */
const IDENTITY = [
  /\b(?:19|20)\d{2}\b(?=\s*(?:born|birth))/i,
  /[\w.+-]+@(?!fpl\.analyser1@gmail\.com)[\w-]+\.[\w.]+/,
]

/** X counts every link as 23 characters regardless of its real length. */
const LINK_WEIGHT = 23
const LINK = /https?:\/\/\S+/g

/** What a post costs against the 280-character limit. */
export function weigh(text) {
  const links = text.match(LINK) || []
  const withoutLinks = text.replace(LINK, '')
  return [...withoutLinks].length + links.length * LINK_WEIGHT
}

/**
 * Every reason this text cannot be posted. An empty array is the only pass.
 *
 * Returns rather than throws so a batch of candidates can report all of its
 * problems at once — a job that fails on the first one takes as many runs to
 * clear as there are faults.
 */
export function check(text, { limit = 280 } = {}) {
  const faults = []
  const lower = text.toLowerCase()

  for (const word of BANNED) {
    // Whole words only: "Betts" is a surname and "odds" inside "oddsmaker"
    // is the same word, but neither should be caught by a bare substring.
    if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
      faults.push(`banned word "${word}" — see docs/DOMAIN_CATEGORISATION.md`)
    }
  }
  for (const pattern of IDENTITY) {
    const hit = pattern.exec(text)
    if (hit) faults.push(`identity leak "${hit[0]}" — see CLAUDE.md`)
  }

  const cost = weigh(text)
  if (cost > limit) faults.push(`${cost} characters against a ${limit} limit`)
  if (!text.trim()) faults.push('empty')

  return faults
}

/**
 * Every number that appears in the text, as written.
 *
 * The rewrite step exists to change wording, never facts, so the check that
 * enforces it is arithmetic rather than editorial: the set of numbers in the
 * rewrite must be a subset of the numbers in the draft. A model that invents
 * a statistic fails this even when the sentence around it reads perfectly,
 * which is exactly the failure a human proof-reader is worst at catching.
 */
export function figures(text) {
  return new Set((text.match(/\d+(?:\.\d+)?/g) || []))
}

/** The numbers a rewrite introduced that its source did not contain. */
export function invented(source, rewrite) {
  const had = figures(source)
  return [...figures(rewrite)].filter((n) => !had.has(n))
}
