// util.js — shared helpers: team names/badges, string utils, tooltips text
 const teamFullNames = {
    'ARS':'Arsenal','AVL':'Aston Villa','BOU':'Bournemouth','BRE':'Brentford','BHA':'Brighton',
    'BUR':'Burnley','CHE':'Chelsea','CRY':'Crystal Palace','EVE':'Everton','FUL':'Fulham',
    'LEE':'Leeds','LIV':'Liverpool','MCI':'Man City','MUN':'Man Utd','NEW':'Newcastle',
    'NFO':"Nott'm Forest",'SUN':'Sunderland','TOT':'Spurs','WHU':'West Ham','WOL':'Wolves'
  };

  const teamCodes = {
  'ARS':3,'AVL':7,'BUR':90,'BOU':91,'BRE':94,'BHA':36,'CHE':8,'CRY':31,
  'EVE':11,'FUL':54,'LEE':2,'LIV':14,'MCI':43,'MUN':1,'NEW':4,'NFO':17,
  'SUN':56,'TOT':6,'WHU':21,'WOL':39
};

function teamBadgeUrl(team) {
  const code = teamCodes[team];
  return code ? `https://resources.premierleague.com/premierleague/badges/t${code}.png` : null;
}

// Small inline team badge to sit next to any team name
function teamBadgeImg(team, size = 14) {
  const url = teamBadgeUrl(team);
  return url ? `<img loading="lazy" class="badge-img" src="${url}" alt="" style="width:${size}px;height:${size}px;object-fit:contain;" onerror="this.style.display='none'">` : '';
}

// Accent-insensitive comparison ("Dubravka" matches "Dúbravka")
function norm(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Escape a name for use inside a single-quoted onclick attribute (O'Riley etc.)
function escQ(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function getPositionEmoji(pos) {
  return { GKP: '🧤', DEF: '🛡️', MID: '⚡', FWD: '⚽' }[pos] || '👤';
}

// Inline SVG icon from the sprite in index.html (stroke follows currentColor)
function icon(name, size = 16, cls = '') {
  return `<svg class="icon ${cls}" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function positionIcon(pos, size = 13) {
  const id = { GKP: 'hand', DEF: 'shield', MID: 'bolt', FWD: 'ball' }[pos] || 'users';
  return icon(id, size);
}

// Star rating: accepts a 0–5 number or a pipeline string like "⭐⭐⭐½".
// Renders a grey track with a gold clipped fill; data-sort feeds table sorting.
function renderStars(value, { size = 13, showNum = true } = {}) {
  const n = typeof value === 'string' ? starsToNum(value)
    : (typeof value === 'number' && !isNaN(value) ? value : null);
  if (n == null) return `<span class="stars stars-na" data-sort="">N/A</span>`;
  const row = icon('star', size).repeat(5);
  return `<span class="stars" data-sort="${n}" role="img" aria-label="${n} out of 5 stars">` +
    `<span class="stars-wrap"><span class="stars-track">${row}</span>` +
    `<span class="stars-fill" style="width:${(n / 5 * 100).toFixed(1)}%">${row}</span></span>` +
    (showNum ? `<span class="stars-num num">${n.toFixed(1)}</span>` : '') +
    `</span>`;
}

function tip(text) {
  return `<span class="tooltip-wrap">
    <span class="tooltip-icon">i</span>
    <span class="tooltip-box">${text}</span>
  </span>`;
}

const TOOLTIPS = {
  overall: 'Weighted composite of all dimension ratings. Reflects output, consistency and reliability combined into one score.',
  save: 'Based on saves per90 and frequency of earning save points (3+ saves per game). Higher = more active shot-stopper.',
  cs: 'Based on clean sheet rate, xGC per90 and goals conceded vs xGC. Higher = better defensive record.',
  goal: 'Based on xG per90 and goals per90, adjusted for shot-profile sustainability: xG backed by shots in the box and shots on target is boosted; xG built on long-range pot-shots is trimmed.',
  creative: 'Based on xA per90 and assists per90, refined with chances created and big chances created per90 when opta data is available.',
  shot_quality: 'Non-penalty xG per shot. High = takes high-quality chances (close range, good positions). Low = shoots from anywhere.',
  finishing_skill: 'Sustained goals-minus-xG. Positive = converting above expectation (clinical); negative = leaving goals on the pitch.',
  creativity_depth: 'xG Chain + xG Buildup per90 — involvement in moves that lead to shots, even without the final pass. Finds deep playmakers whose value xA misses.',
  set_piece: 'Set piece delivery volume per90 (crosses, corners taken, free kick deliveries). Set piece takers have extra assist routes.',
  next4: 'Fixture-adjusted forward rating: the player\'s quality and form (season + last 4 GW ratings) weighted by how attackable their next 4 gameweeks of opponents are, based on opponent recent xG conceded (for attackers) and xG created (for defenders/keepers), with home/away adjustment.',
  dc: 'Based on frequency of hitting the defensive contribution threshold and tackles/interceptions per90.',
  attacking: 'Based on xA and xG per90 for defenders. Identifies defenders who contribute offensively.',
  bps: 'Based on BPS and bonus per90. Players who consistently earn bonus points when they get any return.',
  value: 'Points per game divided by price. Higher = better value for money relative to cost.',
  reliability: 'Start rate across the season. Higher = more nailed in the starting XI.',
  mins90: 'How often a player completes 90 minutes when they start. Lower = frequently substituted.',
  alpha: 'Average points above the position benchmark per game. Positive = outperforming peers. The higher the better.',
  sharpe: 'Risk-adjusted return. Alpha divided by score volatility. Above 1.0 is good, above 2.0 is excellent. Below 0 means underperforming on a risk-adjusted basis.',
  sortino: 'Like Sharpe but only penalises bad weeks (blanks). Above 1.0 is good, above 2.0 is excellent. Higher than Sharpe = good upside with occasional blanks. Lower than Sharpe = volatility mostly on the downside.',
  consistency: 'Measures week-to-week score variation. Below 0.3 = very predictable. Above 0.6 = highly variable. Around 0.4-0.5 is typical.',
  personas: {
    'Shot Stopper': 'High saves and high xGC — this keeper is carrying a leaky defence but making crucial saves.',
    'Premium Keeper': 'High saves but low xGC — faces lots of shots but mostly low quality. Gets save points AND clean sheets.',
    'Sweeper Keeper': 'Low saves and low xGC — easy life behind a solid defence. Buy for clean sheets not save points.',
    'Overperformer': 'Goals conceded significantly below xGC — keeper or defence is beating the odds.',
    'Liability': 'Goals conceded significantly above xGC — errors or bad luck costing points.',
    'Reliable Shieldwall': 'High clean sheets with goals conceded below xGC — deserved defensive record.',
    'Flattering Back': 'High clean sheets but xGC suggests they have been fortunate. May not sustain.',
    'Attacking Defender': 'High xA per90 — this defender contributes significantly in attack.',
    'Scoring Defender': 'High xG per90 for a defender — genuine goal threat from set pieces or runs.',
    'Defensive Workhorse': 'Regularly hits the defensive contribution threshold — earns DC bonus points consistently.',
    'Emerging Contributor': 'Just below the DC threshold regularly — could start earning bonus points soon.',
    'Budget Enabler': 'Cheap, plays regularly and keeps clean sheets. Ideal budget defensive option.',
    'Goal Machine': 'High xG per90 — genuine goal threat with strong underlying numbers.',
    'Clinical Finisher': 'Scoring significantly above their xG — converting chances at an elite rate.',
    'Wasteful Striker': 'High xG but goals well below it — underperforming their chances.',
    'Creative Wizard': 'High xA per90 — elite chance creator.',
    'xGI Beast': 'High combined xG and xA — heavily involved in attacks even when returns do not show.',
    'Defensive Contributor': 'Regularly hits the DC threshold for midfielders — earns defensive bonus points.',
    'Captaincy King': 'Top points scorer — elite captaincy option.',
    'Metronome': 'Consistent moderate returns every week — reliable floor player.',
    'Chaos Merchant': 'High variance — boom or bust. Hard to predict week to week.',
    'Differential': 'Low ownership but decent returns — could give you an edge over your rivals.',
    'Bonus Magnet': 'High BPS — virtually guaranteed bonus points when they get any return.',
    'Minutes Monster': 'Starts almost every game and plays the full 90. Completely nailed.',
    'Minutes Risk': 'Not starting regularly in the last 4 games. Risky to own right now.',
    'Volume Shooter': 'Lots of shots but poor shot quality — long-range efforts that rarely convert. xG may flatter.',
    'Poacher': 'Shots concentrated in the six-yard box with little buildup involvement. Feeds off service.',
    'Set Piece Threat': 'On set piece duty (corners/free kicks) with high delivery volume — extra assist and goal routes.',
    'Aerial Threat': 'Top-quintile headed-shot volume for their position — dangerous from crosses and corners.',
    'Deep Lying Creator': 'High xG chain/buildup with low direct goal threat — drives attacks from deep. Value that xA misses.'
  }
};

function starsToNum(s) {
  if (!s || typeof s !== 'string') return null;
  const stars = (s.match(/⭐/g) || []).length;
  const half = s.includes('½') ? 0.5 : 0;
  const total = stars + half;
  return total > 0 ? total : null;
}

function avgRatingField(rows, field) {
  const vals = rows.map(r => starsToNum(r[field])).filter(v => v !== null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// FPL-style fixture difficulty colours: [background, text]
const FDR_COLORS = { 1: ['#375523','#fff'], 2: ['#01fc7a','#0D1117'], 3: ['#e7e7e7','#0D1117'], 4: ['#ff1751','#fff'], 5: ['#80072d','#fff'] };

// Next-n fixture chips for a team from the pre-computed fixture_ease rows.
// Returns '' when no upcoming fixtures are known (e.g. between seasons).
function fixtureChips(fixtureEase, team, n = 3) {
  const upcoming = (fixtureEase || [])
    .filter(f => f.team === team)
    .sort((a, b) => a.gw - b.gw)
    .slice(0, n);
  if (!upcoming.length) return '';
  return upcoming.map(f => {
    const [bg, fg] = FDR_COLORS[f.fdr] || FDR_COLORS[3];
    return `<span class="fixt-chip" style="background:${bg};color:${fg}" title="GW${f.gw} ${f.venue === 'H' ? 'vs' : 'at'} ${teamFullNames[f.opponent] || f.opponent} (FDR ${f.fdr})">${f.opponent} (${f.venue})</span>`;
  }).join('');
}

export { teamFullNames, teamCodes, teamBadgeUrl, teamBadgeImg, norm, escQ,
         getPositionEmoji, icon, positionIcon, renderStars, tip, TOOLTIPS,
         starsToNum, avgRatingField, FDR_COLORS, fixtureChips };
