/* Attribution register.
 *
 * Every third-party image on the site is listed here with its author, licence
 * and source. This is the machine-readable half of the /legal page — adding a
 * photo means adding a row, and the page picks it up.
 *
 * Unsplash does not require attribution; CC BY and CC BY-SA do, and a credit
 * buried in a repo README does not satisfy them because a visitor cannot reach
 * it. That is why this renders as a page rather than living in a comment.
 *
 * CC BY-SA also carries share-alike: cropping is a derivative, so anything
 * adapted from a BY-SA source must itself be offered under BY-SA. Record the
 * licence honestly here and the page states the obligation for you. */

export interface PhotoCredit {
  /** File under public/, e.g. "stadiums/ARS.jpg". */
  file: string
  /** What it shows, in plain words. */
  subject: string
  author: string
  licence: 'Unsplash' | 'CC0' | 'Public domain' | 'CC BY 4.0' | 'CC BY-SA 4.0' | 'CC BY-SA 3.0' | 'CC BY 2.0' | 'CC BY-SA 2.0'
  /** Page the file came from, so a reader can verify the licence themselves. */
  source?: string
}

/** Licences that legally require the credit to be shown to visitors. */
export const NEEDS_ATTRIBUTION = new Set(['CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-SA 3.0', 'CC BY 2.0', 'CC BY-SA 2.0'])
/** Licences that additionally require derivatives to carry the same licence. */
export const SHARE_ALIKE = new Set(['CC BY-SA 4.0', 'CC BY-SA 3.0', 'CC BY-SA 2.0'])

export const LICENCE_URL: Record<string, string> = {
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
  'CC BY-SA 2.0': 'https://creativecommons.org/licenses/by-sa/2.0/',
  CC0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  Unsplash: 'https://unsplash.com/license',
}

export const PHOTO_CREDITS: PhotoCredit[] = [
  { file: 'stadiums/ARS.jpg', subject: 'Emirates Stadium', author: 'Nelson Ndongala', licence: 'Unsplash', source: 'https://unsplash.com/photos/6AlTY0-Wof0' },
  { file: 'stadiums/CHE.jpg', subject: 'Stamford Bridge', author: 'Virginia Marinova', licence: 'Unsplash', source: 'https://unsplash.com/photos/JcJVNLgeHyU' },
  { file: 'stadiums/FUL.jpg', subject: 'Craven Cottage', author: 'Cristiano Pinto', licence: 'Unsplash', source: 'https://unsplash.com/photos/44my3ToZ1Gc' },
  { file: 'stadiums/LIV.jpg', subject: 'Anfield', author: 'Finn', licence: 'Unsplash', source: 'https://unsplash.com/photos/J_R1BJtd_NU' },
  { file: 'stadiums/TOT.jpg', subject: 'Tottenham Hotspur Stadium', author: 'Winston Tjia', licence: 'Unsplash', source: 'https://unsplash.com/photos/3V2SXDm29JY' },
  { file: 'home/scouting.jpg', subject: 'Matchday from the stands', author: 'Gregorio Cavana', licence: 'Unsplash', source: 'https://unsplash.com/photos/viXFnAKwFN8' },
]

export interface DataSource {
  name: string
  what: string
  /** Whether anything a visitor does is sent to this third party. */
  sendsVisitorData: boolean
  url?: string
}

export const DATA_SOURCES: DataSource[] = [
  {
    name: 'Fantasy Premier League',
    what: 'Player prices, ownership, availability, transfers, fixtures and deadlines. Refreshed daily by a scheduled job and served from this site, so browsing sends nothing to FPL.',
    sendsVisitorData: false,
    url: 'https://fantasy.premierleague.com/',
  },
  {
    name: 'Fantasy Premier League — your team',
    what: 'Only when you enter an FPL team ID on My Team. The FPL API cannot be called from a browser directly, so the request is relayed. See the Privacy tab for who runs that relay.',
    sendsVisitorData: true,
    url: 'https://fantasy.premierleague.com/',
  },
  {
    name: 'Bookmakers’ closing prices',
    what: 'Match odds, converted into the projected goals and clean-sheet chances shown on Preview and Fixtures. Collected by a scheduled job, never at page load.',
    sendsVisitorData: false,
  },
  {
    name: 'Premier League media',
    what: 'Club crests and player headshots, loaded from the Premier League’s own image servers by your browser.',
    sendsVisitorData: true,
    url: 'https://www.premierleague.com/',
  },
]
