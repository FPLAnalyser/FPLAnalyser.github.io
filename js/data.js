// data.js — data store and table loading
// ── Data store ───────────────────────────────────────────────────────────────
const BASE = 'https://raw.githubusercontent.com/stefcourt2004-png/fpl-analyser/main/';
const data = { ratings: [], personas4: [], metrics: [], teamMetrics: [], seasonToDate: [], tierPerf: [], scout: [], scoutMeta: [] };
let loaded = false;

// ── Load all CSVs ────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) || [];
    const obj = {};
    headers.forEach((h, i) => {
      let v = (vals[i] || '').replace(/"/g, '').trim();
      obj[h] = isNaN(v) || v === '' ? v : Number(v);
    });
    return obj;
  });
}

async function loadCSV(file) {
  const r = await fetch(BASE + file);
  const text = await r.text();
  return parseCSV(text);
}

// Preferred path: JSON from site_data/ (relative first so local previews use
// local data, then the published main branch). CSV is the legacy fallback so
// the site keeps working if a pipeline run predates build_site_data.py.
async function loadTable(name, csvFile) {
  for (const url of [`site_data/${name}.json`, `${BASE}site_data/${name}.json`]) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (e) { /* try next source */ }
  }
  if (csvFile) return loadCSV(csvFile);
  throw new Error(`no source for table ${name}`);
}

async function loadAll() {
  try {
    const [ratings, personas4, metrics, teamMetrics, std, tier, fixtureEase, meta,
           benchmarks, replacementPool, personaShifts, priceRisk, playerForm] = await Promise.all([
      loadTable('ratings', 'fpl_analyser_ratings.csv'),
      loadTable('personas_4gw', 'personas_4gw.csv'),
      loadTable('advanced_metrics', 'advanced_metrics.csv'),
      loadTable('team_metrics', 'team_metrics.csv'),
      loadTable('season_to_date', 'season_to_date_per90.csv'),
      loadTable('player_tiers', 'player_tier_performance.csv'),
      loadTable('fixture_ease', null).catch(() => []),
      loadTable('meta', null).catch(() => null),
      // insight-engine tables — optional so an older data drop can't break the site
      loadTable('benchmarks', null).catch(() => null),
      loadTable('replacement_pool', null).catch(() => []),
      loadTable('persona_shifts', null).catch(() => []),
      loadTable('price_risk', null).catch(() => []),
      loadTable('player_form', null).catch(() => [])
    ]);
    data.ratings = ratings;
    data.personas4 = personas4;
    data.metrics = metrics;
    data.teamMetrics = teamMetrics;
    data.seasonToDate = std;
    data.tierPerf = tier;
    data.fixtureEase = fixtureEase;
    data.meta = meta;
    data.benchmarks = benchmarks;
    data.replacementPool = replacementPool;
    data.personaShifts = personaShifts;
    data.priceRisk = priceRisk;
    data.playerForm = playerForm;
    loaded = true;
  } catch(e) {
    console.error('Load error:', e);
  }
}

export { BASE, data, parseCSV, loadCSV, loadTable, loadAll, loaded };
