// The optional AI step: Claude rewrites the wording, never the facts.
//
// This is the only part of the pipeline that can hallucinate, so it is the
// only part with a guard that does not depend on anyone reading the output.
// A rewrite is accepted only if:
//
//   1. every number in it also appears in the draft it came from, and
//   2. it clears the same wording guard the template output cleared, and
//   3. it still fits.
//
// Rule 1 is the important one. An invented statistic reads exactly like a real
// one — that is what makes it dangerous, and what makes proof-reading the
// wrong control for it. Set comparison catches it every time and costs
// nothing. A rewrite that fails any rule is discarded silently and the
// template draft ships instead, because a slightly stiffer sentence is a much
// better failure than a smooth false one.
//
// Skipped entirely when ANTHROPIC_API_KEY is unset, which is the default. The
// deterministic drafts are the product; this is polish.

import { check, invented, weigh } from './wording.mjs'

const MODEL = 'claude-opus-5'

const SYSTEM = `You rewrite social posts for FPL Analyser, a free Fantasy Premier League analytics site.

You are given a draft that was generated from the site's own data. Rewrite it to read
more naturally. You are editing WORDING ONLY.

Rules, in order of importance:
- Never change, add, remove or round a number. Every figure in your rewrite must appear
  in the draft, unchanged.
- Never add a claim the draft does not make. No predictions, no advice, no superlatives
  the draft did not already earn.
- Keep the URL exactly as given, on its own line at the end.
- Never use the words odds, bookmaker, betting, bet, wager, accumulator, punt or stake.
  The site's numbers take market-implied probabilities as an input and this is a domain
  classification risk, not a style preference.
- Stay under 260 characters including the URL.
- Plain, direct, British English. No emoji, no hashtags, no "Did you know". Do not open
  with a question. Sound like someone who built the tool, not someone marketing it.

Reply with the rewritten post and nothing else.`

/**
 * Rewrites each draft in place, adding `.polished` where the result survived
 * every check. Leaves the draft untouched otherwise.
 */
export async function polishAll(drafts) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error('polish: ANTHROPIC_API_KEY unset — shipping the template drafts')
    return
  }

  let Anthropic
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'))
  } catch {
    console.error('polish: @anthropic-ai/sdk not installed — shipping the template drafts')
    return
  }

  const client = new Anthropic({ apiKey: key })

  for (const draft of drafts) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        // Low effort: this is a rewrite of forty words, and the interesting
        // work — deciding what to say — already happened in stories.mjs.
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: draft.text }],
      })

      // Claude Opus 5 can decline a request outright, and a refusal is a
      // successful 200 with an empty content array — reading content[0]
      // without checking this is how that surfaces as a crash.
      if (response.stop_reason === 'refusal') {
        console.error(`polish: ${draft.id} declined (${response.stop_details?.category ?? 'no category'})`)
        continue
      }

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim()

      const faults = [
        ...check(text),
        ...invented(draft.text, text).map((n) => `invented the figure ${n}`),
        ...(text.includes(draft.url) ? [] : ['dropped the link']),
      ]

      if (faults.length) {
        console.error(`polish: ${draft.id} rejected — ${faults.join('; ')}`)
        continue
      }

      draft.polished = text
      draft.polishedChars = weigh(text)
    } catch (err) {
      // A rewrite is a nice-to-have; the morning's post is not worth failing
      // over a network blip or a rate limit.
      console.error(`polish: ${draft.id} failed — ${err.message}`)
    }
  }
}
