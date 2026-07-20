// narrative.ts — turns raw tables into sentences: player verdicts for the
// player page hero, and league-level stories for the Home briefing.
// Pure functions, no DOM and no data.js import (same contract as engine.ts).
import { makeTeamEase } from './engine';

const num = (v: any): number | null => (v == null || v === '' || isNaN(v) ? null : Number(v));
const pct = (v: any): number => Math.round(v * 100);

// blendedPpg / blendedScore live in rules.js; inlined here (rules.ts not ported)
// to keep narrative self-contained while preserving the exact calculation.
function blendedPpg(r: Record<string, any>): number | null {
  const s = num(r.season_ppg), g = num(r.gw4_ppg);
  if (s == null && g == null) return null;
  if (s == null) return g;
  if (g == null) return s;
  return 0.5 * s + 0.5 * g;
}

function blendedScore(r: Record<string, any>): number | null {
  const s = num(r.season_overall_score), g = num(r.gw4_overall_score);
  if (s == null && g == null) return null;
  return 0.5 * (s ?? g!) + 0.5 * (g ?? s!);
}

// ── Player bundle: everything narrative needs about one player ───────────────
// ref: a web_name string or an element id. data: the loaded site_data store.
function buildPlayerBundle(ref: string | number, data: any): any {
  const byRef = (rows: any[]) => (rows || []).find(
    typeof ref === 'number' ? (x: any) => x.element === ref : (x: any) => x.web_name === ref);
  const r = byRef(data.ratings);
  if (!r) return null;
  return {
    r,
    m: (data.metrics || []).find((x: any) => x.element === r.element) || null,
    std: (data.seasonToDate || []).find((x: any) => x.element === r.element) || null,
    p4: (data.personas4 || []).find((x: any) => x.element === r.element) || null,
    priceRisk: (data.priceRisk || []).find((x: any) => x.element === r.element) || null,
    fixtureEase: data.fixtureEase || [],
    hasFixtures: (data.fixtureEase || []).length > 0,
  };
}

// ── Headline rating (0–100) ──────────────────────────────────────────────────
// Between seasons: the season overall rating (season_overall_score × 20), the
// SAME number shown on the Rankings/Players ratings — never a peer percentile,
// so a player's rating is one consistent figure everywhere.
// With fixtures: a captain rating = blended form × fixture ease, expressed as a
// percentile among in-form peers (a genuinely different, fixture-aware number,
// labelled "Captain rating").
function ratingPercentile(bundle: any, data: any): number | null {
  const { r, hasFixtures } = bundle;
  if (!hasFixtures) {
    const s = num(r.season_overall_score);
    return s == null ? null : Math.round(Math.max(0, Math.min(100, s * 20)));
  }
  const broad = (p: string) => (p === 'GKP' ? 'GKP' : p === 'DEF' ? 'DEF' : 'ATT');
  const peers = (data.ratings || []).filter((x: any) =>
    x.season_ok && broad(x.position) === broad(r.position) &&
    ((num(x.gw4_start_rate) ?? num(x.season_start_rate) ?? 0) >= 0.7));
  const scoreOf = (x: any) => (blendedScore(x) ?? 0) * (num(x.next4_fixture_factor) ?? 1);
  const mine = scoreOf(r);
  if (!peers.length || mine == null) return null;
  const below = peers.filter((x: any) => scoreOf(x) < mine).length;
  return Math.min(99, Math.round(below / Math.max(peers.length - 1, 1) * 100));
}

function verdictLabel(score: number, hasFixtures: boolean, hasRisk: boolean): string {
  const labels: [number, string][] = hasFixtures
    ? [[90, 'Elite captaincy option'], [75, 'Strong pick'], [55, 'Solid squad option'], [35, 'Monitor'], [0, 'Avoid for now']]
    : [[90, 'Elite season'], [75, 'Excellent season'], [55, 'Solid season'], [35, 'Squad player'], [0, 'Below the benchmark']];
  const label = (labels.find(([min]) => score >= min) || labels[labels.length - 1])[1];
  return hasRisk && score >= 55 ? `${label} — with a caveat` : label;
}

// ── The verdict: headline rating + 3-6 narrative bullets ─────────────────────
// Every bullet is conditional on its fields existing; each carries the
// evidence inline so no claim ships without the numbers.
function buildPlayerVerdict(bundle: any, data: any): any {
  const { r, m, std, p4, priceRisk, hasFixtures } = bundle;
  const bullets: any[] = [];
  const isAtt = ['MID', 'FWD'].includes(r.position);
  const recentLabel = hasFixtures ? 'the last 4 GWs' : 'the final 4 GWs of the season';

  // Form: recent points pace vs season baseline
  const p90s = num(std && std.pts_per90_season), p90g = num(std && std.pts_per90_4gw);
  if (p90s != null && p90g != null && p90s > 0.5) {
    const delta = (p90g - p90s) / p90s * 100;
    if (Math.abs(delta) >= 12) {
      const up = delta > 0;
      bullets.push({
        iconId: up ? 'flame' : 'snow', tone: up ? 'good' : 'bad',
        html: `${up ? 'In form' : 'Cooling off'}: <strong>${p90g.toFixed(1)} pts/90</strong> over ${recentLabel} — ${up ? '+' : ''}${delta.toFixed(0)}% vs their season baseline of ${p90s.toFixed(1)}`,
      });
    } else {
      bullets.push({
        iconId: 'check', tone: 'info',
        html: `Steady output: <strong>${p90g.toFixed(1)} pts/90</strong> over ${recentLabel}, right on their season pace`,
      });
    }
  }

  // Underlying xG vs season average (attackers, meaningful volume only)
  const xgS = num(std && std.xg_per90_season), xgG = num(std && std.xg_per90_4gw);
  if (isAtt && xgS != null && xgG != null && xgS > 0.1) {
    const delta = (xgG - xgS) / xgS * 100;
    if (Math.abs(delta) >= 10) {
      bullets.push({
        iconId: delta > 0 ? 'trend-up' : 'trend-down', tone: delta > 0 ? 'good' : 'warn',
        html: `xG running <strong>${delta > 0 ? '+' : ''}${delta.toFixed(0)}% ${delta > 0 ? 'above' : 'below'}</strong> season average (${xgG.toFixed(2)} vs ${xgS.toFixed(2)} per 90)`,
      });
    }
  }

  // Fixtures: next 4 by FDR (omitted entirely between seasons)
  if (hasFixtures) {
    const next4 = bundle.fixtureEase
      .filter((f: any) => f.team === r.team)
      .sort((a: any, b: any) => a.gw - b.gw)
      .slice(0, 4);
    if (next4.length >= 2) {
      const kind = next4.filter((f: any) => num(f.fdr) != null && f.fdr <= 2);
      const avgFdr = next4.reduce((s: number, f: any) => s + (num(f.fdr) ?? 3), 0) / next4.length;
      const list = (fs: any[]) => fs.map((f: any) => `${f.opponent} (${f.venue})`).join(', ');
      if (kind.length >= 2) {
        bullets.push({
          iconId: 'calendar', tone: 'good',
          html: `Faces <strong>${kind.length} of the next ${next4.length}</strong> at FDR ≤ 2: ${list(kind)}`,
        });
      } else if (avgFdr >= 3.8) {
        bullets.push({
          iconId: 'calendar', tone: 'warn',
          html: `Tough run ahead — <strong>${list(next4)}</strong> averages FDR ${avgFdr.toFixed(1)}`,
        });
      }
    }

    // Projection: blended pace × fixture factor over the next 4
    const ppg = blendedPpg(r), factor = num(r.next4_fixture_factor);
    if (ppg != null && factor != null) {
      bullets.push({
        iconId: 'target', tone: 'info',
        html: `Projected <strong>${(ppg * factor * 4).toFixed(1)} pts</strong> over the next 4 GWs (form × fixture model)`,
      });
    }
  }

  // Role: share of the team's attacking output + leading persona
  const xgShare = num(m && m.xg_share_4gw), xaShare = num(m && m.xa_share_4gw);
  const topPersona = p4 && p4.personas && p4.personas !== 'None' ? p4.personas.split(', ')[0] : null;
  if (isAtt && (xgShare != null && xgShare >= 0.15 || xaShare != null && xaShare >= 0.15)) {
    const parts: string[] = [];
    if (xgShare != null && xgShare >= 0.15) parts.push(`<strong>${pct(xgShare)}%</strong> of ${r.team}'s xG`);
    if (xaShare != null && xaShare >= 0.15) parts.push(`<strong>${pct(xaShare)}%</strong> of the xA`);
    bullets.push({
      iconId: 'bolt', tone: 'info',
      html: `Carries ${parts.join(' and ')}${topPersona ? ` · plays like a <strong>${topPersona}</strong>` : ''}`,
    });
  } else if (topPersona) {
    bullets.push({ iconId: 'eye', tone: 'info', html: `Profile: plays like a <strong>${topPersona}</strong>` });
  }

  // Risk: minutes or price
  let hasRisk = false;
  const flags = String(p4 && p4.flags || '');
  if (flags.includes('Minutes Risk')) {
    hasRisk = true;
    bullets.push({
      iconId: 'alert', tone: 'bad',
      html: `Only <strong>${p4.starts_last4 ?? 0} of 4</strong> recent starts — minutes risk`,
    });
  }
  if (priceRisk && priceRisk.risk === 'drop') {
    hasRisk = true;
    bullets.push({
      iconId: 'coin', tone: 'warn',
      html: `Heavy net sales — <strong>price drop likely</strong> (${Number(priceRisk.net_transfers_2gw).toLocaleString('en-GB')} net out over 2 GWs)`,
    });
  }

  const score = ratingPercentile(bundle, data);
  return {
    score,
    scoreLabel: hasFixtures ? 'Captain rating' : 'FPL Analyser rating',
    verdict: score != null ? verdictLabel(score, hasFixtures, hasRisk) : null,
    tone: score == null ? 'info' : hasRisk ? 'warn' : score >= 75 ? 'good' : score >= 35 ? 'info' : 'bad',
    bullets: bullets.slice(0, 5),
    financeLine: m ? getFinanceInsight(
      r.web_name, r.position,
      num(m.alpha_4gw), num(m.sharpe_4gw), num(m.sortino_4gw), num(m.consistency_4gw)
    ) : null,
  };
}

// ── Finance-persona verdict (moved unchanged from players.js) ─────────────────
function getFinanceInsight(
  name: string, pos: string,
  alpha: number | null, sharpe: number | null, sortino: number | null, consistency: number | null,
): string | null {
  if (!alpha && alpha !== 0) return null;

  const posLabel = ({ GKP: 'goalkeeper', DEF: 'defender', MID: 'midfielder', FWD: 'forward' } as Record<string, string>)[pos] || 'player';

  if (alpha > 2 && sharpe! > 1.5 && consistency! < 0.4) {
    return `<strong>Consistent outperformer</strong> — ${name} generates strong returns well above the ${posLabel} benchmark with low week-to-week variance. A reliable captain option who delivers regularly.`;
  }
  if (alpha > 2 && sharpe! < 1.0 && consistency! > 0.5) {
    return `<strong>Boom or bust</strong> — ${name} generates elite points but with high unpredictability. Can haul big in good weeks but blanks are frequent. Best captained when fixtures align rather than as a weekly armband choice.`;
  }
  if (alpha > 1 && sortino! > sharpe! && consistency! > 0.4) {
    return `<strong>Haul merchant</strong> — ${name} produces occasional big scores that boost their average, but blanks between returns. Higher Sortino than Sharpe confirms the upside is real. Worth captaining against weak opposition.`;
  }
  if (alpha > 0 && sharpe! > 1.0 && consistency! < 0.45) {
    return `<strong>Reliable floor</strong> — ${name} consistently delivers modest returns above the ${posLabel} benchmark with minimal variance. A safe budget pick who provides a predictable points floor each week.`;
  }
  if (alpha > 0 && sharpe! > 0 && consistency! > 0.5) {
    return `<strong>Streaky performer</strong> — ${name} outperforms the benchmark on average but their week-to-week output is inconsistent. Useful in good runs but hard to rely on across a full month.`;
  }
  if (alpha < 0 && sortino! > 0) {
    return `<strong>Underperforming with upside</strong> — ${name} is below the ${posLabel} benchmark overall but their downside risk is limited. May be going through a temporary dip — check their hot/cold streak and upcoming fixtures.`;
  }
  if (alpha < 0 && sortino! < 0) {
    return `<strong>Avoid or sell</strong> — ${name} is underperforming the ${posLabel} benchmark with poor risk-adjusted returns. Unless fixtures improve dramatically, better options are likely available.`;
  }
  return `<strong>Average performer</strong> — ${name} is performing broadly in line with the ${posLabel} benchmark. Monitor form and fixtures before investing further.`;
}

// ── Home briefing stories ─────────────────────────────────────────────────────
// Each story: { title, iconId, tone, player? (ratings row), score?, scoreLabel?,
//               bullets: [{iconId, tone, html}] }
function buildLeagueStories(data: any): any[] {
  const inSeason = data.meta && data.meta.next_gw != null && (data.fixtureEase || []).length > 0;
  return inSeason ? weeklyStories(data) : recapStories(data);
}

function playerStory(title: string, iconId: string, tone: string, row: any, data: any, extraBullets: any[] = []): any {
  const bundle = buildPlayerBundle(row.element ?? row.web_name, data);
  if (!bundle) return null;
  const v = buildPlayerVerdict(bundle, data);
  return {
    title, iconId, tone,
    player: bundle.r,
    score: v.score, scoreLabel: v.scoreLabel, verdict: v.verdict,
    bullets: [...extraBullets, ...v.bullets].slice(0, 4),
  };
}

function weeklyStories(data: any): any[] {
  const stories: any[] = [];

  // 1 — the captaincy verdict: best form × fixtures over the next 4
  const captains = (data.ratings || [])
    .filter((p: any) => p.season_ok && num(p.next4_score) != null)
    .sort((a: any, b: any) => (b.next4_score || 0) - (a.next4_score || 0));
  if (captains.length) {
    const s = playerStory('Captain of the week', 'crown', 'good', captains[0], data);
    if (s) stories.push(s);
  }

  // 2 — the biggest fixture swing, in whichever direction is larger
  const { teamEase, teamFixtureList } = makeTeamEase(data.fixtureEase);
  const teams = [...new Set((data.fixtureEase || []).map((f: any) => f.team))];
  let best: any = null;
  for (const team of teams) {
    const near = teamEase(team as string, 0, 3), later = teamEase(team as string, 3, 3);
    if (near == null || later == null) continue;
    const swing = later - near;
    if (!best || Math.abs(swing) > Math.abs(best.swing)) best = { team, near, later, swing };
  }
  if (best && Math.abs(best.swing) >= 0.12) {
    const opening = best.swing > 0;
    stories.push({
      title: 'Fixture swing to plan around', iconId: 'calendar', tone: opening ? 'good' : 'warn',
      team: best.team,
      bullets: [{
        iconId: opening ? 'trend-up' : 'trend-down', tone: opening ? 'good' : 'warn',
        html: opening
          ? `<strong>${best.team}</strong>'s run opens up after the next 3 — attack ease climbs from ×${best.near.toFixed(2)} to <strong>×${best.later.toFixed(2)}</strong>. Buy their attackers before the swing, not after.`
          : `<strong>${best.team}</strong>'s run turns brutal after the next 3 — ease falls from ×${best.near.toFixed(2)} to <strong>×${best.later.toFixed(2)}</strong>. If you're selling, move before the swing.`,
      }, {
        iconId: 'eye', tone: 'info',
        html: `Next up: ${teamFixtureList(best.team, 3)}`,
      }],
    });
  }

  // 3 — the form story that's real, not variance (hot AND xGI backs it)
  const hot = (data.seasonToDate || [])
    .filter((p: any) => p.streak === '🔥 Hot' && num(p.xgi_delta) != null && p.xgi_delta > 0)
    .sort((a: any, b: any) => (b.pts_delta || 0) - (a.pts_delta || 0));
  if (hot.length) {
    const h = hot[0];
    const s = playerStory('Form that looks real', 'flame', 'good',
      { element: h.element, web_name: h.web_name }, data,
      [{
        iconId: 'flame', tone: 'good',
        html: `<strong>+${Number(h.pts_delta).toFixed(1)} pts/90</strong> above baseline, and the underlying xGI is up too — this is form, not luck`,
      }]);
    if (s) stories.push(s);
  }

  return stories.slice(0, 3);
}

function recapStories(data: any): any[] {
  const rated = (data.ratings || []).filter((p: any) => p.season_ok);
  const stories: any[] = [];

  const top = [...rated].sort((a: any, b: any) => (b.season_overall_score || 0) - (a.season_overall_score || 0))[0];
  if (top) {
    const s = playerStory('Player of the season', 'trophy', 'good', top, data);
    if (s) stories.push(s);
  }

  const value = [...rated]
    .filter((p: any) => num(p.season_value_score) != null && num(p.price) != null)
    .sort((a: any, b: any) => (b.season_value_score || 0) - (a.season_value_score || 0))[0];
  if (value && (!top || value.element !== top.element)) {
    const s = playerStory('Best value of the season', 'coin', 'good', value, data,
      [{ iconId: 'coin', tone: 'good', html: `<strong>${num(value.season_ppg) != null ? value.season_ppg.toFixed(1) : '—'} ppg</strong> at just £${value.price}m — the league's best points-per-pound` }]);
    if (s) stories.push(s);
  }

  const clinical = [...rated]
    .filter((p: any) => ['MID', 'FWD'].includes(p.position) && num(p.season_finishing_skill_score) != null)
    .sort((a: any, b: any) => (b.season_finishing_skill_score || 0) - (a.season_finishing_skill_score || 0))[0];
  if (clinical && num(clinical.season_finishing_skill_score)! > 1) {
    const s = playerStory('Most clinical finisher', 'target', 'good', clinical, data,
      [{ iconId: 'target', tone: 'good', html: `Scored <strong>+${Number(clinical.season_finishing_skill_score).toFixed(1)} goals above xG</strong> — elite finishing sustained across the season` }]);
    if (s) stories.push(s);
  }

  return stories.slice(0, 3);
}

export { buildPlayerBundle, buildPlayerVerdict, buildLeagueStories, getFinanceInsight, ratingPercentile };
