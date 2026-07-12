// engine.js — My Team insight engine core. Pure functions: no DOM access and
// no data.js import, so the whole thing can be unit-tested in node.
//
// Insight shape: { rule_id, severity, headline, body, evidence, suggestions[] }
// Severities: 'act' (🔴 do something) > 'warn' (🟡 watch closely)
//           > 'info' (🔵 worth knowing) > 'good' (🟢 positive signal)

const SEVERITY_ORDER = { act: 0, warn: 1, info: 2, good: 3 };
const SEVERITY_META = {
  act: { icon: '🔴', label: 'Action', color: '#FF6B6B' },
  warn: { icon: '🟡', label: 'Watch', color: '#eab308' },
  info: { icon: '🔵', label: 'Worth knowing', color: '#58a6ff' },
  good: { icon: '🟢', label: 'Good news', color: '#38D9A9' },
};
const MAX_PER_SEVERITY = 4;

// league: { ratings, personas4, seasonToDate, playerForm, priceRisk,
//           personaShifts, teamMetrics, benchmarks, replacementPool, fixtureEase }
// picksData: FPL picks payload; historyData: FPL entry history payload (or null)
function buildContext(picksData, historyData, league) {
  const picks = picksData.picks || [];
  const entryHistory = picksData.entry_history || {};
  const byEl = (rows) => {
    const m = new Map();
    (rows || []).forEach(r => m.set(r.element, r));
    return m;
  };
  const maps = {
    ratings: byEl(league.ratings),
    personas: byEl(league.personas4),
    std: byEl(league.seasonToDate),
    form: byEl(league.playerForm),
    priceRisk: byEl(league.priceRisk),
    shifts: byEl(league.personaShifts),
  };

  const squad = picks.map(pick => ({
    pick,
    isStarter: pick.position <= 11,
    r: maps.ratings.get(pick.element) || null,
    p4: maps.personas.get(pick.element) || null,
    std: maps.std.get(pick.element) || null,
    form: maps.form.get(pick.element) || null,
    priceRisk: maps.priceRisk.get(pick.element) || null,
    shift: maps.shifts.get(pick.element) || null,
  }));

  const positionGroups = {};
  for (const pos of ['GKP', 'DEF', 'MID', 'FWD']) {
    positionGroups[pos] = squad.filter(s => s.r && s.r.position === pos && s.isStarter);
  }

  // fixture ease helper: avg attack-ease for a team over upcoming GWs
  // [skip, take]: teamEase('ARS', 0, 3) = next 3; teamEase('ARS', 3, 3) = the 3 after
  const easeByTeam = {};
  (league.fixtureEase || []).forEach(f => {
    (easeByTeam[f.team] = easeByTeam[f.team] || []).push(f);
  });
  Object.values(easeByTeam).forEach(list => list.sort((a, b) => a.gw - b.gw));

  function teamEase(team, skipGws, nGws) {
    const rows = easeByTeam[team] || [];
    if (!rows.length) return null;
    const gws = [...new Set(rows.map(f => f.gw))].slice(skipGws, skipGws + nGws);
    if (gws.length < nGws) return null;
    const sel = rows.filter(f => gws.includes(f.gw));
    return sel.reduce((s, f) => s + (f.att_ease || 1), 0) / sel.length;
  }

  function teamFixtureList(team, nGws) {
    return (easeByTeam[team] || []).slice(0, nGws)
      .map(f => `${f.opponent} (${f.venue})`).join(', ');
  }

  return {
    squad,
    starters: squad.filter(s => s.isStarter),
    captain: squad.find(s => s.pick.is_captain) || null,
    positionGroups,
    bank: entryHistory.bank != null ? entryHistory.bank / 10 : null,
    history: historyData || null,
    benchmarks: league.benchmarks || null,
    teamMetrics: league.teamMetrics || [],
    replacementPool: league.replacementPool || [],
    fixtureEase: league.fixtureEase || [],
    teamEase,
    teamFixtureList,
    ownedElements: new Set(picks.map(p => p.element)),
  };
}

function runRules(rules, ctx) {
  const fired = [];
  for (const rule of rules) {
    try {
      const out = rule.run(ctx);
      if (Array.isArray(out)) fired.push(...out.map(i => ({ rule_id: rule.id, severity: rule.severity, ...i })));
      else if (out) fired.push({ rule_id: rule.id, severity: rule.severity, ...out });
    } catch (e) {
      // A broken rule must never take down the report
      console.error(`insight rule ${rule.id} failed:`, e);
    }
  }
  fired.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  const counts = {};
  return fired.filter(i => {
    counts[i.severity] = (counts[i.severity] || 0) + 1;
    return counts[i.severity] <= MAX_PER_SEVERITY;
  });
}

export { buildContext, runRules, SEVERITY_META, SEVERITY_ORDER, MAX_PER_SEVERITY };
