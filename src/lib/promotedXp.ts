/* ════════════════════════════════════════════════════════════════════════
   Supplied GW1 projections, for players our own engine cannot reach.

   Two groups, one mechanism.

   The promoted clubs first. Hull, Coventry and Ipswich have no Premier League
   record, so the component engine in `xp.ts` has nothing to build a per-90
   rate from and returns null for all of their players — no expected points
   anywhere on the site for three of the twenty clubs, on the gameweek
   everyone is picking a squad for.

   Then the players who fall below the rating floor. A season rating needs 900
   minutes and 10 starts, and 201 players in the game clear neither — some
   because they never played in the Premier League last year, most because
   they did not play enough of it. That is the right gate for a rating and it
   leaves a hole in the projections: Mosquera at 17.3% ownership was nine
   starts, one short; Chris Wood was 896 minutes, four short. The twenty most
   owned of those 201 carry 83% combined ownership between them, and every one
   of them showed N/A. They are covered here; the tail of fringe players is
   not, and honestly should not be.

   These figures are entered by hand rather than produced by the pipeline,
   and they are held here rather than merged into the ratings feed so that
   stays exactly what the engine wrote. Nothing on the site distinguishes them
   from a modelled number, which is a deliberate decision of the owner's and
   the reason this file has a short shelf life.

   Scope and shelf life:
   - Gameweek 1 only. From GW2 the clubs have played, the pipeline has real
     rates, and this file should be deleted rather than extended.
   - Cartwright (HUL, GKP) and Bassette (COV, FWD) were not in the source, and
     are left null rather than guessed at.
   - Targett and Morita (HUL) and Scherpen and Maeda (IPS) are in the FPL game
     but not in `ratings.json`, which was generated on 23 July — nine days
     before the source was captured, in an open transfer window. They are
     keyed by element id here so they work the moment the squad list is
     regenerated. Their figures are 0.0, so nothing on screen moves; the
     reason to carry them is that leaving them out would record a wrong
     conclusion. The real problem they point at is in BACKLOG.md: the squad
     list has no scheduled refresh, and nine players are missing from it.

   Keyed on FPL element id, which is stable across a season, rather than on
   the web name, which is not.
   ════════════════════════════════════════════════════════════════════════ */

/** The only gameweek these cover. */
export const SUPPLIED_XP_GW = 1
/** Clubs with no Premier League record this season. */
export const PROMOTED_CLUBS = new Set(['HUL', 'COV', 'IPS'])

const PROMOTED: ReadonlyArray<readonly [number, number]> = [
  [182, 0.7], // COV DEF Amenda
  [178, 1.0], // COV DEF Bidwell
  [181, 0.3], // COV DEF Brau
  [176, 0.5], // COV DEF Dasilva
  [177, 1.0], // COV DEF Kesler-Hayden
  [174, 1.5], // COV DEF Kitching
  [179, 0.8], // COV DEF Latibeaudiere
  [173, 0.7], // COV DEF Thomas
  [180, 1.2], // COV DEF Woolfenden
  [175, 1.2], // COV DEF van Ewijk
  [196, 0.7], // COV FWD Markelo
  [195, 1.2], // COV FWD Simms
  [194, 2.0], // COV FWD Thomas-Asante
  [193, 1.1], // COV FWD Wright
  [171, 2.4], // COV GKP Dovin
  [172, 0.4], // COV GKP Wilson
  [192, 0.3], // COV MID Andrews
  [191, 0.4], // COV MID Borges Rodrigues
  [187, 1.6], // COV MID Eccles
  [184, 2.2], // COV MID Grimes
  [186, 1.1], // COV MID Mason-Clark
  [104, 1.2], // COV MID Onyeka
  [183, 1.1], // COV MID Rudoni
  [185, 1.6], // COV MID Sakamoto
  [189, 0.3], // COV MID Shepherd
  [190, 2.0], // COV MID Tchaouna
  [188, 2.1], // COV MID Torp
  [279, 1.7], // HUL DEF Ajayi
  [280, 1.4], // HUL DEF Coyle
  [281, 1.2], // HUL DEF Drameh
  [277, 2.0], // HUL DEF Egan
  [282, 1.6], // HUL DEF Giles
  [278, 1.1], // HUL DEF Hughes
  [283, 0.0], // HUL DEF Jacob
  [284, 0.9], // HUL DEF McCarthy
  [285, 1.9], // HUL DEF McNair
  [299, 2.0], // HUL FWD Burstow
  [298, 1.0], // HUL FWD Destan
  [295, 2.4], // HUL FWD McBurnie
  [274, 2.5], // HUL GKP Butland
  [276, 0.4], // HUL GKP Lo-Tutala
  [273, 0.0], // HUL GKP Phillips
  [296, 1.2], // HUL MID Akintola
  [286, 2.1], // HUL MID Belloumi
  [289, 2.0], // HUL MID Crooks
  [288, 1.5], // HUL MID Dowell
  [297, 2.3], // HUL MID Gyabi
  [293, 0.9], // HUL MID Kamara
  [291, 0.9], // HUL MID Matazo
  [287, 1.9], // HUL MID Millar
  [290, 2.3], // HUL MID Slater
  [294, 0.0], // HUL MID Zambrano
  [292, 1.9], // HUL MID Ömür
  [305, 1.8], // IPS DEF Davis
  [259, 1.9], // IPS DEF Diop
  [308, 1.7], // IPS DEF Furlong
  [306, 2.5], // IPS DEF Greaves
  [307, 1.9], // IPS DEF Johnson
  [303, 1.2], // IPS DEF Kipré
  [304, 2.7], // IPS DEF O'Shea
  [320, 2.0], // IPS FWD Akpom
  [322, 1.3], // IPS FWD Al-Hamadi
  [316, 1.6], // IPS FWD Emersonn
  [317, 2.0], // IPS FWD Hirst
  [321, 0.0], // IPS FWD Walle Egeli
  [302, 0.0], // IPS GKP Button
  [301, 0.5], // IPS GKP Palmer
  [300, 3.0], // IPS GKP Walton
  [554, 0.0], // IPS GKP van Oevelen
  [311, 1.3], // IPS MID Burns
  [313, 1.1], // IPS MID Clarke
  [315, 1.9], // IPS MID Fatawu
  [310, 2.4], // IPS MID Matusiwa
  [323, 2.1], // IPS MID McAteer
  [324, 1.6], // IPS MID Mehmeti
  [309, 2.5], // IPS MID Núñez
  [314, 2.3], // IPS MID Ogbene
  [318, 2.1], // IPS MID Philogene
  [319, 2.7], // IPS MID Szmodics
  [312, 2.0], // IPS MID Taylor
  [556, 0.0], // HUL DEF Targett — not yet in ratings.json (23 Jul snapshot)
  [563, 0.0], // HUL MID Morita — not yet in ratings.json
  [562, 0.0], // IPS MID Maeda — not yet in ratings.json
  [564, 0.0], // IPS GKP Scherpen — not yet in ratings.json
]

/* The second group: established-club players the 900-minute / 10-start floor
 * leaves without a projection. Ordered by ownership, which is the only reason
 * these twenty and not another twenty — each one's absence was visible to a
 * meaningful share of readers. Verified element by element against the squad
 * list before being written down; a wrong id here would silently attach one
 * player's projection to another. */
const BELOW_FLOOR: ReadonlyArray<readonly [number, number]> = [
  [11, 3.0],   // ARS DEF Mosquera      17.3% owned — 9 starts, one short of the gate
  [379, 4.6],  // LIV FWD Isak          11.4% — 694 minutes
  [272, 0.5],  // FUL FWD Kusi-Asare     8.6% — 49 minutes
  [489, 1.0],  // NFO MID Yates          7.6% — 602 minutes
  [111, 0.1],  // BHA GKP Steele         5.0% — no Premier League minutes
  [26, 4.0],   // ARS FWD Havertz        4.0% — 577 minutes
  [58, 0.1],   // BOU GKP Forster        3.1% — no Premier League minutes
  [53, 3.0],   // AVL MID Manzambi       2.7% — no Premier League minutes
  [504, 2.0],  // BHA DEF Vuskovic       2.7% — no Premier League minutes
  [515, 3.5],  // TOT MID Maddison       2.4% — 34 minutes
  [362, 0.7],  // LIV DEF Jacquet        2.3% — no Premier League minutes
  [539, 0.4],  // SUN DEF O'Nien         2.3% — 565 minutes
  [149, 2.8],  // CHE DEF Colwill        2.0% — 225 minutes
  [230, 3.9],  // EVE DEF Branthwaite    2.0% — 678 minutes
  [490, 2.0],  // NFO FWD Wood           1.8% — 896 minutes, four short of the gate
  [528, 0.1],  // TOT FWD Scarlett       1.8% — below the floor
  [555, 0.1],  // CRY GKP Matthews       1.7% — below the floor
  [38, 0.2],   // AVL DEF A.García       1.5% — below the floor
  [152, 0.2],  // CHE DEF Palestra       1.5% — below the floor
  [157, 1.7],  // CHE MID Estêvão        1.5% — below the floor
]

const SUPPLIED = [...PROMOTED, ...BELOW_FLOOR] as ReadonlyArray<readonly [number, number]>

const BY_ELEMENT = new Map<number, number>(SUPPLIED.map(([el, xp]) => [el, xp]))

/** A supplied GW1 figure, or null where there is none. */
export function suppliedXp(element: number | null | undefined, gw: number): number | null {
  if (gw !== SUPPLIED_XP_GW || element == null) return null
  return BY_ELEMENT.get(element) ?? null
}

/** How many players this covers — the /debug page reports it. */
export const SUPPLIED_XP_COUNT = SUPPLIED.length
/** Split out so the data notes can name each group rather than one total. */
export const SUPPLIED_XP_PROMOTED_COUNT = PROMOTED.length
export const SUPPLIED_XP_FLOOR_COUNT = BELOW_FLOOR.length

/** True when this player's figure for this gameweek is the supplied one
 *  rather than ours. Kept as its own question rather than a field on
 *  `XpParts`, which is summed by iterating its keys and so has to stay
 *  entirely numeric. Anything drawing the number should ask this and say so. */
export function isSuppliedXp(element: number | null | undefined, gw: number): boolean {
  return suppliedXp(element, gw) != null
}
