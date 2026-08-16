#!/usr/bin/env node
// Turns this morning's data into posts you can approve from your phone.
//
//   node tools/social/draft.mjs                       # print to stdout
//   node tools/social/draft.mjs --json build/social/drafts.json --markdown build/social/drafts.md
//   node tools/social/draft.mjs --polish              # + a Claude rewrite pass
//
// Deliberately drafts rather than posts. An account that publishes on a timer
// with nobody reading first is one bad morning of data away from saying
// something wrong to everyone at once, and at launch the follower count is
// worth less than the credibility. Approval costs about ten seconds; being
// wrong in public costs more than that.
//
// The numbers come from `site_data`, the sentences from templates here, and
// nothing in this file invents a fact. `--polish` optionally hands the drafts
// to Claude for wording only, and the result is checked arithmetically before
// it is allowed anywhere near the output — see polish.mjs.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { currentSeason, loadSeason, rank } from './stories.mjs'
import { check, weigh } from './wording.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const flag = (name) => argv.includes(`--${name}`)

const count = Number(arg('count', 3))
const season = arg('season', null)
const jsonOut = arg('json', null)
const mdOut = arg('markdown', null)
const polish = flag('polish')
// Story ids posted recently, so the same shape does not go out three days
// running. The workflow passes what it finds in the last few issues.
const exclude = String(arg('exclude', '')).split(',').map((s) => s.trim()).filter(Boolean)

const CTA = 'fplanalyser.co.uk'

/**
 * One story as a post.
 *
 * The link is last because X truncates the preview card, not the text, and a
 * reader who has already decided from the first line does not need to reach
 * the URL to have got the point.
 */
function compose(story) {
  const body = story.lines.join('\n\n')
  return `${body}\n\n${story.url}`
}

/** A shorter one, for when the composed post overruns. */
function composeTight(story) {
  return `${story.lines[0]}\n\n${story.url}`
}

const data = await loadSeason(season || await currentSeason())
const stories = rank(data, { exclude })

if (!stories.length) {
  console.error('no stories in this data — nothing to draft')
  process.exit(2)
}

const drafts = []
for (const story of stories.slice(0, count)) {
  let text = compose(story)
  // Tighten rather than truncate: a post cut mid-sentence at 280 reads as a
  // bug, and the first line alone is always a complete thought.
  if (weigh(text) > 280) text = composeTight(story)

  const faults = check(text)
  drafts.push({
    id: story.id,
    kind: story.kind,
    score: Math.round(story.score * 100) / 100,
    repeat: story.repeat,
    headline: story.headline,
    facts: story.facts,
    url: story.url,
    text,
    chars: weigh(text),
    faults,
  })
}

// A single unpostable draft fails the whole run. The alternative is an issue
// that silently contains one candidate nobody may use, and the person reading
// it on a phone at 07:00 is not going to notice which one.
const blocked = drafts.filter((d) => d.faults.length)
if (blocked.length) {
  console.error('drafts failed the wording guard:\n')
  for (const d of blocked) {
    console.error(`  ${d.id}: ${d.faults.join('; ')}`)
    console.error(`    ${d.text.replace(/\n/g, ' ⏎ ')}\n`)
  }
  process.exit(1)
}

if (polish) {
  const { polishAll } = await import('./polish.mjs')
  await polishAll(drafts)
}

const manifest = {
  season: season || data.meta.season,
  generated_at: data.meta.generated_at,
  next_gw: data.meta.next_gw,
  provisional: data.meta.provisional,
  drafts,
}

if (jsonOut) {
  await mkdir(path.dirname(jsonOut), { recursive: true })
  await writeFile(jsonOut, `${JSON.stringify(manifest, null, 2)}\n`)
}

const md = [
  // Machine-readable, so tomorrow's run can read what today's drafted straight
  // off the issue and demote a repeat. The issues are the record; a state file
  // committed alongside them would be a second one, free to drift.
  `<!-- story-ids: ${drafts.map((d) => d.id).join(',')} -->`,
  '',
  `Drafted from \`site_data/${manifest.season}\`, generated ${manifest.generated_at}.`,
  manifest.provisional ? '\nPre-season: per-game numbers are carried from last season and the copy says so.' : '',
  '',
  ...drafts.flatMap((d) => [
    `### ${d.headline}`,
    '',
    `\`${d.id}\` · ${d.chars}/280 characters · interest ${d.score}${d.repeat ? ' · posted recently' : ''}`,
    ...(d.polished ? [`\nRewritten by Claude. Original below.`] : []),
    '',
    '```',
    d.polished || d.text,
    '```',
    ...(d.polished ? ['', '<details><summary>Original</summary>', '', '```', d.text, '```', '', '</details>'] : []),
    '',
  ]),
].join('\n')

if (mdOut) {
  await mkdir(path.dirname(mdOut), { recursive: true })
  await writeFile(mdOut, md)
}
if (!jsonOut && !mdOut) console.log(md)

console.error(`${drafts.length} draft(s) · ${drafts.map((d) => d.id).join(', ')}`)
