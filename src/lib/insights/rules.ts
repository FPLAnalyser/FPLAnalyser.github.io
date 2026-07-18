// rules.ts — the insight rules library. Each rule is { id, severity, run(ctx) }
// where run returns null, one insight, or an array of insights:
//   { headline, body, evidence, suggestions?, severity? (override) }
// Every insight must carry an evidence line — never a claim without the numbers.
import { starsToNum } from '../util';

type Ctx = any;

const num = (v: any): number | null => (v == null || v === '' || isNaN(v) ? null : Number(v));

// Blended points-per-game: half season-long level, half recent form
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
  return 0.5 * (s ?? g)! + 0.5 * (g ?? s)!;
}

const RULES: Array<{ id: string; severity: string; run(ctx: Ctx): any }> = [

  // 1 — defender/midfielder whose defensive contributions dried up
  {
    id: 'def_dc_decline',
    severity: 'warn',
    run(ctx: Ctx) {
      return ctx.starters
        .filter((s: any) => s.r && ['DEF', 'MID'].includes(s.r.position))
        .map((s: any) => {
          const season = starsToNum(s.r.season_dc_score_rating);
          const recent = starsToNum(s.r.gw4_dc_score_rating);
          if (!(season != null && season >= 3.5 && recent != null && recent <= 2)) return null;
          return {
            headline: `${s.r.web_name}'s defensive contributions have dried up`,
            body: `A ${s.r.season_dc_score_rating} DefCon player all season, but only ${s.r.gw4_dc_score_rating} over the last 4 gameweeks. If the DC bonus points were part of why you own ${s.r.web_name}, that floor has dropped.`,
            evidence: `DefCon rating: season ${s.r.season_dc_score_rating} → last 4 GWs ${s.r.gw4_dc_score_rating}`,
          };
        })
        .filter(Boolean);
    },
  },

  // 2 — a defensive asset's team has stopped keeping clean sheets
  {
    id: 'cs_drought',
    severity: 'warn',
    run(ctx: Ctx) {
      const defTeams = new Map<any, string[]>();
      ctx.starters
        .filter((s: any) => s.r && ['GKP', 'DEF'].includes(s.r.position))
        .forEach((s: any) => {
          (defTeams.get(s.r.team) || defTeams.set(s.r.team, []).get(s.r.team))!.push(s.r.web_name);
        });
      const out: any[] = [];
      for (const [team, names] of defTeams) {
        const season = ctx.teamMetrics.find((t: any) => t.team === team && t.window === 'season');
        const recent = ctx.teamMetrics.find((t: any) => t.team === team && t.window === '4gw');
        if (!season || !recent) continue;
        const sRate = num(season.cs_rate) ?? 0, rRate = num(recent.cs_rate) ?? 0;
        if (sRate >= 0.25 && rRate <= 0.25 * sRate) {
          out.push({
            headline: `${team}'s clean sheets have collapsed`,
            body: `${team} keep a clean sheet in ${(sRate * 100).toFixed(0)}% of games this season, but over the last 4 gameweeks that's fallen to ${(rRate * 100).toFixed(0)}%. That hits your ${names.join(' and ')}.`,
            evidence: `CS rate: season ${(sRate * 100).toFixed(0)}% → last 4 GWs ${(rRate * 100).toFixed(0)}%`,
          });
        }
      }
      return out;
    },
  },

  // 3 — captaincy sense-check against underlying xGI
  {
    id: 'captain_underperforming',
    severity: 'warn',
    run(ctx: Ctx) {
      const c = ctx.captain;
      if (!c || !c.r || !c.form) return null;
      const xgi = num(c.form.expected_goal_involvements_4gw);
      const returns = (num(c.form.goals_scored_4gw) ?? 0) + (num(c.form.assists_4gw) ?? 0);
      const mins = num(c.form.minutes_4gw) ?? 0;
      if (xgi == null || mins < 180) return null;
      if (xgi >= 2.5 && returns <= 1) {
        return {
          severity: 'good',
          headline: `Your captain ${c.r.web_name} is due — persist`,
          body: `Only ${returns} return${returns === 1 ? '' : 's'} in the last 4 gameweeks, but the underlying numbers are elite: ${xgi.toFixed(1)} expected goal involvements. That gap usually closes in the owner's favour.`,
          evidence: `Last 4 GWs: ${xgi.toFixed(2)} xGI vs ${returns} actual returns (G+A)`,
        };
      }
      if (['MID', 'FWD'].includes(c.r.position) && xgi <= 1.0) {
        return {
          headline: `Captaincy check: ${c.r.web_name}'s underlying threat is thin`,
          body: `Your armband is on a player producing just ${xgi.toFixed(1)} expected goal involvements over 4 gameweeks. Recent returns may be masking a low ceiling — worth comparing options before the deadline.`,
          evidence: `Last 4 GWs: ${xgi.toFixed(2)} xGI in ${Math.round(mins)} minutes`,
        };
      }
      return null;
    },
  },

  // 4 — points rotting on the bench
  {
    id: 'bench_waste',
    severity: 'info',
    run(ctx: Ctx) {
      const events = ctx.history && ctx.history.current;
      if (!events || events.length < 2) return null;
      const last4 = events.slice(-4);
      const benchPts = last4.map((e: any) => num(e.points_on_bench) ?? 0);
      const avg = benchPts.reduce((a: number, b: number) => a + b, 0) / benchPts.length;
      if (avg < 8) return null;
      return {
        headline: `You're leaving points on the bench`,
        body: `An average of ${avg.toFixed(1)} points per gameweek sat on your bench across the last ${last4.length} — that's a starter's worth of output not counting. Your team selection may need a rethink rather than a transfer.`,
        evidence: `Bench points, last ${last4.length} GWs: ${benchPts.join(', ')} (avg ${avg.toFixed(1)})`,
      };
    },
  },

  // 5 — starters losing their place (aggregated into one card so several
  // risky players can't crowd out other action-level insights)
  {
    id: 'minutes_decline',
    severity: 'act',
    run(ctx: Ctx) {
      const risky = ctx.starters
        .filter((s: any) => s.r && s.p4 && String(s.p4.flags || '').includes('Minutes Risk'));
      if (!risky.length) return null;
      if (risky.length === 1) {
        const s = risky[0];
        return {
          headline: `${s.r.web_name} is losing minutes`,
          body: `Only ${s.p4.starts_last4 ?? 0} start${(s.p4.starts_last4 ?? 0) === 1 ? '' : 's'} in the last 4 gameweeks. A player who doesn't start can't score — this is the most common slow points leak in FPL squads.`,
          evidence: `${s.p4.starts_last4 ?? 0} of 4 recent games started · flagged Minutes Risk`,
        };
      }
      const names = risky.map((s: any) => s.r.web_name);
      return {
        headline: `${risky.length} of your starters are losing minutes`,
        body: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are all starting irregularly. Players who don't start can't score — prioritise fixing the ones you rely on most.`,
        evidence: risky.map((s: any) => `${s.r.web_name} ${s.p4.starts_last4 ?? 0}/4 starts`).join(' · '),
      };
    },
  },

  // 6 — a player's identity has shifted vs their season profile
  {
    id: 'persona_shift',
    severity: 'info',
    run(ctx: Ctx) {
      return ctx.starters
        .filter((s: any) => s.shift && (s.shift.lost.length || s.shift.gained.length))
        .slice(0, 3)
        .map((s: any) => {
          const bits: string[] = [];
          if (s.shift.lost.length) bits.push(`no longer playing like a ${s.shift.lost.join(' / ')}`);
          if (s.shift.gained.length) bits.push(`now showing as a ${s.shift.gained.join(' / ')}`);
          return {
            headline: `${s.r ? s.r.web_name : s.shift.web_name}'s profile is shifting`,
            body: `Over the last 4 gameweeks they are ${bits.join(' and ')}. Persona shifts often front-run rating changes — worth understanding why before it shows in the points.`,
            evidence: `${s.shift.lost.length ? 'Lost: ' + s.shift.lost.join(', ') : ''}${s.shift.lost.length && s.shift.gained.length ? ' · ' : ''}${s.shift.gained.length ? 'Gained: ' + s.shift.gained.join(', ') : ''}`,
          };
        });
    },
  },

  // 7 — an owned player's team enters (or approaches) a kind run
  {
    id: 'fixture_swing_good',
    severity: 'good',
    run(ctx: Ctx) {
      const out: any[] = [];
      for (const [team, names] of ownedByTeam(ctx)) {
        const near = ctx.teamEase(team, 0, 3);
        const later = ctx.teamEase(team, 3, 3);
        if (near == null) continue;
        if (near >= 1.10) {
          out.push({
            headline: `${team}'s fixtures open up now`,
            body: `A kind run starts immediately: ${ctx.teamFixtureList(team, 3)}. Good window for ${names.join(' and ')} — and a reason to hold rather than sell.`,
            evidence: `Next-3 attack ease ×${near.toFixed(2)} vs league average`,
          });
        } else if (later != null && later - near >= 0.15) {
          out.push({
            headline: `${team}'s run turns kind shortly`,
            body: `The next few fixtures are tough but the schedule opens up after: ease improves from ×${near.toFixed(2)} to ×${later.toFixed(2)}. If you're planning moves for ${names.join(' and ')}, patience is the play.`,
            evidence: `Attack ease: GWs 1-3 ×${near.toFixed(2)} → GWs 4-6 ×${later.toFixed(2)}`,
          });
        }
      }
      return out;
    },
  },

  // 8 — an owned player's team hits a wall
  {
    id: 'fixture_swing_bad',
    severity: 'warn',
    run(ctx: Ctx) {
      const out: any[] = [];
      for (const [team, names] of ownedByTeam(ctx)) {
        const near = ctx.teamEase(team, 0, 3);
        const later = ctx.teamEase(team, 3, 3);
        if (near == null) continue;
        // 3+ players in a bad run is the team_exposure rule's story — don't duplicate
        if (names.length >= 3 && near <= 0.9) continue;
        if (near <= 0.85) {
          out.push({
            headline: `${team} are in a brutal run right now`,
            body: `${ctx.teamFixtureList(team, 3)} — well below league-average attacking ease. Expect thin returns from ${names.join(' and ')} until it passes.`,
            evidence: `Next-3 attack ease ×${near.toFixed(2)} vs league average`,
          });
        } else if (later != null && near - later >= 0.15) {
          out.push({
            headline: `${team} hit a wall after the next few games`,
            body: `Ease drops from ×${near.toFixed(2)} to ×${later.toFixed(2)}. If you're going to move ${names.join(' or ')} on, doing it before the swing beats doing it after.`,
            evidence: `Attack ease: GWs 1-3 ×${near.toFixed(2)} → GWs 4-6 ×${later.toFixed(2)}`,
          });
        }
      }
      return out;
    },
  },

  // 9 — a position group is underperforming: name the weak spot, offer replacements
  {
    id: 'weak_spot_replacements',
    severity: 'act',
    run(ctx: Ctx) {
      if (!ctx.benchmarks) return null;
      const out: any[] = [];
      for (const pos of ['GKP', 'DEF', 'MID', 'FWD']) {
        const group = ctx.positionGroups[pos] || [];
        if (group.length < 2 && pos !== 'GKP') continue;
        if (!group.length) continue;
        const bench = ctx.benchmarks[pos];
        if (!bench) continue;
        const benchPpg = (num(bench.season_ppg_median) != null && num(bench.gw4_ppg_median) != null)
          ? 0.5 * bench.season_ppg_median + 0.5 * bench.gw4_ppg_median
          : num(bench.season_ppg_median) ?? num(bench.gw4_ppg_median);
        if (benchPpg == null) continue;
        const withPpg = group.map((s: any) => ({ s, ppg: blendedPpg(s.r) })).filter((x: any) => x.ppg != null);
        if (!withPpg.length) continue;
        const avg = withPpg.reduce((a: number, x: any) => a + x.ppg, 0) / withPpg.length;
        if (avg > benchPpg - 1.0) continue;
        const worst = withPpg.sort((a: any, b: any) => a.ppg - b.ppg)[0].s;
        const budget = worst.r.price + (ctx.bank ?? 0);
        const suggestions = suggestReplacements(ctx, pos, budget);
        const posLabel = ({ GKP: 'goalkeeping', DEF: 'defence', MID: 'midfield', FWD: 'forward line' } as Record<string, string>)[pos];
        out.push({
          headline: `Your ${posLabel} is underperforming the league`,
          body: `Your starting ${pos} group averages ${avg.toFixed(1)} points per game against a league median of ${benchPpg.toFixed(1)}. ${worst.r.web_name} (${blendedPpg(worst.r)!.toFixed(1)} ppg) is the weakest link${suggestions.length ? ` — options at your ~£${budget.toFixed(1)}m budget below` : ''}.`,
          evidence: `${pos} starters avg ${avg.toFixed(2)} ppg vs league median ${benchPpg.toFixed(2)} (blend of season + last 4 GWs)`,
          suggestions,
        });
      }
      return out;
    },
  },
  // 10 — differentials worth knowing about (low ownership, high form)
  {
    id: 'differential_opportunity',
    severity: 'info',
    run(ctx: Ctx) {
      const picks = (ctx.replacementPool || [])
        .filter((p: any) => !ctx.ownedElements.has(p.element) &&
          num(p.selected_by_percent) != null && p.selected_by_percent < 5 &&
          (starsToNum(p.gw4_overall_rating) ?? -Infinity) >= 4 &&
          ((num(p.gw4_start_rate) ?? num(p.season_start_rate) ?? 0) >= 0.7) &&
          (num(p.next4_fixture_factor) == null || p.next4_fixture_factor >= 1.0))
        .sort((a: any, b: any) => (blendedScore(b) ?? 0) - (blendedScore(a) ?? 0))
        .slice(0, 3);
      if (!picks.length) return null;
      return {
        headline: `Differential watch: ${picks.map((p: any) => p.web_name).join(', ')}`,
        body: `Under 5% owned, in ${picks.length > 1 ? '4-star-plus form' : '4-star-plus form'} and minutes-secure. Low-owned players outperforming their price are how you gain ground on your rivals.`,
        evidence: picks.map((p: any) => `${p.web_name} ${p.selected_by_percent}% owned · ${p.gw4_overall_rating} last 4`).join(' · '),
      };
    },
  },

  // 11 — owned players being sold fast (price-drop risk)
  {
    id: 'price_drop_risk',
    severity: 'warn',
    run(ctx: Ctx) {
      const droppers = ctx.squad.filter((s: any) => s.r && s.priceRisk && s.priceRisk.risk === 'drop');
      if (!droppers.length) return null;
      const names = droppers.map((s: any) => s.r.web_name);
      return {
        headline: `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} being sold fast — price drop likely`,
        body: `Heavy net transfers out this week. If you were planning to sell anyway, move before the drop to protect your budget; if you're holding, a 0.1 dip is rarely worth panicking over.`,
        evidence: droppers.map((s: any) => `${s.r.web_name}: ${s.priceRisk.net_transfers_2gw.toLocaleString()} net transfers (2 GWs)`).join(' · '),
      };
    },
  },

  // 12 — premium player not justifying the price tag
  {
    id: 'premium_not_delivering',
    severity: 'warn',
    run(ctx: Ctx) {
      return ctx.starters
        .filter((s: any) => s.r && (num(s.r.price) ?? -Infinity) >= 9.0 &&
          starsToNum(s.r.season_value_score_rating) != null &&
          starsToNum(s.r.season_value_score_rating)! <= 2 &&
          s.m && num(s.m.alpha_4gw) != null && s.m.alpha_4gw < 0)
        .slice(0, 2)
        .map((s: any) => ({
          headline: `${s.r.web_name} at £${Number(s.r.price).toFixed(1)}m isn't paying their way`,
          body: `A premium price with a ${s.r.season_value_score_rating} value rating and returns below the ${s.r.position} benchmark over the last month. That's a big slice of budget underperforming — the strongest case for a transfer is usually here.`,
          evidence: `£${Number(s.r.price).toFixed(1)}m · value ${s.r.season_value_score_rating} · alpha (4GW) ${Number(s.m.alpha_4gw).toFixed(2)}`,
        }));
    },
  },

  // 13 — goal threat built on a shaky shot profile
  {
    id: 'unsustainable_goal_threat',
    severity: 'warn',
    run(ctx: Ctx) {
      return ctx.starters
        .filter((s: any) => s.r && ['MID', 'FWD'].includes(s.r.position) &&
          (starsToNum(s.r.season_goal_score_rating) ?? -Infinity) >= 4 &&
          ((starsToNum(s.r.season_shot_quality_score_rating) != null &&
            starsToNum(s.r.season_shot_quality_score_rating)! <= 2) ||
           String(s.p4 && s.p4.personas || '').includes('Volume Shooter')))
        .slice(0, 2)
        .map((s: any) => ({
          headline: `${s.r.web_name}'s goal threat may not stick`,
          body: `The headline goal-threat rating is strong, but the shot profile behind it is poor quality${String(s.p4 && s.p4.personas || '').includes('Volume Shooter') ? ' — flagged as a Volume Shooter (long-range efforts that rarely convert)' : ''}. Don't pay for the xG without checking where the shots come from.`,
          evidence: `Goal threat ${s.r.season_goal_score_rating} vs shot quality ${s.r.season_shot_quality_score_rating || 'N/A'}`,
        }));
    },
  },

  // 14 — scoring above the underlying numbers: regression coming
  {
    id: 'regression_warning',
    severity: 'info',
    run(ctx: Ctx) {
      return ctx.starters
        .filter((s: any) => s.r && ['MID', 'FWD'].includes(s.r.position) &&
          num(s.r.season_finishing_skill_score) != null && s.r.season_finishing_skill_score >= 3 &&
          starsToNum(s.r.season_shot_quality_score_rating) != null &&
          starsToNum(s.r.season_shot_quality_score_rating)! <= 2)
        .slice(0, 2)
        .map((s: any) => ({
          headline: `${s.r.web_name} is scoring above their chances — enjoy it, expect regression`,
          body: `${Number(s.r.season_finishing_skill_score).toFixed(1)} goals more than the chances merit, from a low-quality shot profile. Hot finishing runs end; don't extrapolate the recent scoring rate when deciding whether to keep or captain them.`,
          evidence: `Goals − xG: +${Number(s.r.season_finishing_skill_score).toFixed(1)} · shot quality ${s.r.season_shot_quality_score_rating}`,
        }));
    },
  },

  // 15 — keeper profile: save-points machine vs clean-sheet keeper
  {
    id: 'keeper_profile',
    severity: 'info',
    run(ctx: Ctx) {
      const gk = (ctx.positionGroups.GKP || [])[0];
      if (!gk || !gk.r) return null;
      const save = starsToNum(gk.r.season_save_score_rating);
      const cs = starsToNum(gk.r.season_cs_score_rating);
      if (save == null || cs == null) return null;
      if (save >= 4 && cs <= 2) {
        const alt = (ctx.replacementPool || [])
          .filter((p: any) => p.position === 'GKP' && !ctx.ownedElements.has(p.element) &&
            num(p.price) != null && p.price <= (num(gk.r.price) ?? 5) + (ctx.bank ?? 0))
          .sort((a: any, b: any) => (blendedScore(b) ?? 0) - (blendedScore(a) ?? 0))[0];
        return {
          headline: `${gk.r.web_name} earns points from saves, not clean sheets`,
          body: `Elite shot-stopping numbers behind a leaky defence. That's fine while the saves flow, but the ceiling is capped without clean sheets${alt ? ` — ${alt.web_name} (£${Number(alt.price).toFixed(1)}m) offers more CS upside at your budget` : ''}.`,
          evidence: `Save rating ${gk.r.season_save_score_rating} vs clean sheet rating ${gk.r.season_cs_score_rating}`,
        };
      }
      return null;
    },
  },

  // 16 — heavy exposure to one club entering a bad run
  {
    id: 'team_exposure',
    severity: 'warn',
    run(ctx: Ctx) {
      const counts = new Map<any, string[]>();
      ctx.squad.filter((s: any) => s.r).forEach((s: any) => {
        (counts.get(s.r.team) || counts.set(s.r.team, []).get(s.r.team))!.push(s.r.web_name);
      });
      const out: any[] = [];
      for (const [team, names] of counts) {
        if (names.length < 3) continue;
        const ease = ctx.teamEase(team, 0, 3);
        if (ease != null && ease <= 0.9) {
          out.push({
            headline: `Heavy ${team} exposure into a tough run`,
            body: `${names.length} of your squad (${names.join(', ')}) depend on ${team}, whose next fixtures are well below league-average ease: ${ctx.teamFixtureList(team, 3)}. One bad month hits ${Math.round(names.length / 15 * 100)}% of your squad at once.`,
            evidence: `${names.length} players · next-3 attack ease ×${ease.toFixed(2)}`,
          });
        }
      }
      return out;
    },
  },

  // 17 — captaincy advisor: risk-adjusted form × fixture
  {
    id: 'captaincy_advisor',
    severity: 'good',
    run(ctx: Ctx) {
      const nextGw = ctx.fixtureEase.length ? Math.min(...ctx.fixtureEase.map((f: any) => f.gw)) : null;
      const candidates = ctx.starters
        .filter((s: any) => s.r && ['MID', 'FWD'].includes(s.r.position) && s.m && num(s.m.alpha_4gw) != null)
        .map((s: any) => {
          const fixt = nextGw != null
            ? ctx.fixtureEase.find((f: any) => f.team === s.r.team && f.gw === nextGw)
            : null;
          const ease = fixt ? (fixt.att_ease || 1) : 1;
          const consistency = num(s.m.consistency_4gw);
          // alpha × fixture ease, nudged by predictability (low variance = safer armband)
          const score = s.m.alpha_4gw * ease * (consistency != null && consistency < 0.45 ? 1.1 : 1);
          return { s, fixt, ease, score };
        })
        .filter((c: any) => c.score > 0)
        .sort((a: any, b: any) => b.score - a.score);
      if (candidates.length < 2) return null;
      const top = candidates[0];
      const isCurrent = ctx.captain && ctx.captain.pick.element === top.s.pick.element;
      const fixtStr = top.fixt ? ` — ${top.fixt.opponent} (${top.fixt.venue}) is ×${top.ease.toFixed(2)} ease` : '';
      return {
        headline: isCurrent
          ? `Armband check: ${top.s.r.web_name} is the right call`
          : `Armband case: ${top.s.r.web_name} over ${ctx.captain && ctx.captain.r ? ctx.captain.r.web_name : 'your current pick'}`,
        body: `Best risk-adjusted captaincy option in your XI: ${top.s.r.web_name} leads on points above the positional benchmark${fixtStr}. ${candidates[1] ? `Next best: ${candidates[1].s.r.web_name}.` : ''}`,
        evidence: candidates.slice(0, 3).map((c: any) =>
          `${c.s.r.web_name} α${Number(c.s.m.alpha_4gw).toFixed(1)}${c.fixt ? ` ×${c.ease.toFixed(2)}` : ''}`).join(' · '),
      };
    },
  },

  // 18 — the form players you're missing / the cold ones you own
  {
    id: 'streak_mismatch',
    severity: 'info',
    run(ctx: Ctx) {
      const out: any[] = [];
      const std = ctx.league.seasonToDate || [];
      const hotMissed = std
        .filter((p: any) => p.streak === '🔥 Hot' && !ctx.ownedElements.has(p.element))
        .sort((a: any, b: any) => (b.pts_delta || 0) - (a.pts_delta || 0))
        .slice(0, 3);
      if (hotMissed.length) {
        out.push({
          headline: `Form players you don't own: ${hotMissed.map((p: any) => p.web_name).join(', ')}`,
          body: `The league's hottest players right now, all outside your squad. Worth a look before their prices rise and everyone else catches on.`,
          evidence: hotMissed.map((p: any) => `${p.web_name} +${Number(p.pts_delta).toFixed(1)} pts/90 vs baseline`).join(' · '),
        });
      }
      const coldOwned = ctx.starters
        .filter((s: any) => s.std && s.std.streak === '🧊 Cold' && num(s.std.pts_delta) != null && s.std.pts_delta <= -2);
      if (coldOwned.length) {
        out.push({
          severity: 'warn',
          headline: `${coldOwned.map((s: any) => s.r ? s.r.web_name : s.std.web_name).join(' and ')} ${coldOwned.length > 1 ? 'are' : 'is'} ice cold`,
          body: `Well below their season baseline over the last month. Cold streaks end — but check the underlying numbers (minutes, xGI) before deciding whether this is variance or decline.`,
          evidence: coldOwned.map((s: any) => `${s.r ? s.r.web_name : ''} ${Number(s.std.pts_delta).toFixed(1)} pts/90 vs baseline`).join(' · '),
        });
      }
      return out;
    },
  },
];

// helper: teams of owned starters -> [team, [names]]
function ownedByTeam(ctx: Ctx): Map<any, string[]> {
  const m = new Map<any, string[]>();
  ctx.starters.filter((s: any) => s.r).forEach((s: any) => {
    if (!m.has(s.r.team)) m.set(s.r.team, []);
    m.get(s.r.team)!.push(s.r.web_name);
  });
  return m;
}

// Top-3 replacement candidates for a position within budget
function suggestReplacements(ctx: Ctx, pos: string, budget: number) {
  let pool = (ctx.replacementPool || []).filter((p: any) =>
    p.position === pos &&
    !ctx.ownedElements.has(p.element) &&
    num(p.price) != null && p.price <= budget &&
    ((num(p.gw4_start_rate) ?? num(p.season_start_rate) ?? 0) >= 0.7));
  // Prefer kind fixtures when fixture data exists; relax if it filters everyone out
  const withFixtures = pool.filter((p: any) => num(p.next4_fixture_factor) == null || p.next4_fixture_factor >= 1.0);
  if (withFixtures.length >= 3) pool = withFixtures;
  const ranked = pool
    .map((p: any) => ({ p, score: (blendedScore(p) ?? 0) * (num(p.next4_fixture_factor) ?? 1) }))
    .sort((a: any, b: any) => b.score - a.score);
  // diversity guard: at most 2 suggestions from the same club
  const perTeam: Record<string, number> = {};
  const picked: any[] = [];
  for (const item of ranked) {
    perTeam[item.p.team] = (perTeam[item.p.team] || 0) + 1;
    if (perTeam[item.p.team] > 2) continue;
    picked.push(item);
    if (picked.length === 3) break;
  }
  return picked
    .map(({ p }: any) => {
      const bits = [`${(p.gw4_overall_rating || p.season_overall_rating || 'N/A')} form`];
      if (num(p.next4_fixture_factor) != null) bits.push(`×${Number(p.next4_fixture_factor).toFixed(2)} fixtures`);
      const startRate = num(p.gw4_start_rate) ?? num(p.season_start_rate);
      if (startRate != null) bits.push(`${Math.round(startRate * 100)}% starts`);
      if (num(p.season_ppg) != null) bits.push(`${p.season_ppg.toFixed(1)} ppg`);
      return {
        element: p.element,
        web_name: p.web_name,
        team: p.team,
        position: p.position,
        price: p.price,
        code: p.code,
        rating: p.season_overall_rating || p.gw4_overall_rating || 'N/A',
        reason: bits.join(' · '),
      };
    });
}

export { RULES, blendedPpg, blendedScore };
