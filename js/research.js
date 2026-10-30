// Turns a season of results into per-team profiles (record, splits, form, standing),
// then adds Sleeper's season stats (per-game numbers, league ranks, starters) when a
// research page needs them. Also finds common opponents and who-beat-whom chains
// between two teams.
import { DIVISIONS } from './teams.js';

const per = (total, games) => (games ? total / games : 0);
const resultOf = (pf, pa) => (pf > pa ? 'W' : pf < pa ? 'L' : 'T');

// "W-L" or "W-L-T".
export function recordOf(games) {
  const w = games.filter((g) => g.result === 'W').length;
  const l = games.filter((g) => g.result === 'L').length;
  const t = games.length - w - l;
  return `${w}-${l}${t ? `-${t}` : ''}`;
}

/**
 * Every team's season from its results: [{ week, home, away, homeScore, awayScore }].
 * Each team gets its games (oldest first), record, home and road records, last five,
 * streak, points, and division standing.
 */
export function buildLeague(results) {
  const teams = new Map();
  const team = (abbr) => {
    if (!teams.has(abbr)) teams.set(abbr, { abbr, games: [] });
    return teams.get(abbr);
  };
  for (const g of results) {
    for (const [me, opp, pf, pa, home] of [
      [g.home, g.away, g.homeScore, g.awayScore, true],
      [g.away, g.home, g.awayScore, g.homeScore, false],
    ]) {
      team(me).games.push({ week: g.week, opp, home, pf, pa, result: resultOf(pf, pa) });
    }
  }

  for (const t of teams.values()) {
    t.games.sort((a, b) => a.week - b.week);
    t.gp = t.games.length;
    t.wins = t.games.filter((g) => g.result === 'W').length;
    t.losses = t.games.filter((g) => g.result === 'L').length;
    t.ties = t.gp - t.wins - t.losses;
    t.record = recordOf(t.games);
    t.homeRecord = recordOf(t.games.filter((g) => g.home));
    t.roadRecord = recordOf(t.games.filter((g) => !g.home));
    t.lastFive = t.games.slice(-5);
    const last = t.games.at(-1);
    if (last) {
      const run = t.games.length - 1 - t.games.findLastIndex((g) => g.result !== last.result);
      t.streak = `${last.result}${run}`;
    }
    t.pointsFor = t.games.reduce((sum, g) => sum + g.pf, 0);
    t.pointsAgainst = t.games.reduce((sum, g) => sum + g.pa, 0);
    t.pointDiff = t.pointsFor - t.pointsAgainst;
  }

  // Division rank: win percentage (a tie counts as half a win, as the NFL counts it),
  // then point differential.
  for (const [division, members] of Object.entries(DIVISIONS)) {
    const pct = (t) => (t.wins + t.ties / 2) / Math.max(1, t.wins + t.losses + t.ties);
    const ranked = members.map((a) => teams.get(a)).filter(Boolean).sort((a, b) => pct(b) - pct(a) || b.pointDiff - a.pointDiff);
    ranked.forEach((t, i) => (t.standing = `${['1st', '2nd', '3rd', '4th'][i]} in ${division}`));
  }

  return { teams, size: [...teams.values()].filter((t) => t.gp).length };
}

// Offense totals read from a team's own game row. Passing yards are net of sacks (the
// NFL's team number), so passing plus rushing is total yards.
const GAME_TOTALS = {
  passYd: (s) => (s.pass_yd ?? 0) - (s.pass_sack_yds ?? 0),
  rushYd: (s) => s.rush_yd ?? 0,
  plays: (s) => (s.pass_att ?? 0) + (s.rush_att ?? 0) + (s.pass_sack ?? 0),
  thirdConv: (s) => s.down_3_conv ?? 0,
  thirdAtt: (s) => s.down_3_att ?? 0,
  rzConv: (s) => s.rz_conv ?? 0,
  rzAtt: (s) => s.rz_att ?? 0,
  sacked: (s) => s.pass_sack ?? 0,
  giveaways: (s) => (s.pass_int ?? 0) + (s.fum_lost ?? 0),
  games: () => 1, // rows counted, so per-game numbers divide by games that have stats
};

/**
 * Adds Sleeper's season stats to a league from buildLeague: per-game and rate numbers,
 * a 1..32 league rank on each, and this week's expected starters.
 * stats: { players: player rows, games: TEAM rows, one per team per game, with its week }
 * (api.fetchSeasonStats)
 */
export function addStats(league, stats) {
  const { teams } = league;
  // Each game row counts once for the team (its offense) and once for its opponent
  // (what that defense allowed): `off` and `def` totals.
  for (const t of teams.values()) {
    t.off = Object.fromEntries(Object.keys(GAME_TOTALS).map((k) => [k, 0]));
    t.def = { ...t.off };
    t.players = [];
  }
  // The league can be older than the stats (built when the page loaded), so only games
  // it already counts are added: a game finished since, or still live, is left out.
  const counted = (team, week) => team?.games.some((g) => g.week === week);
  for (const row of stats?.games ?? []) {
    const offense = counted(teams.get(row.team), row.week) ? teams.get(row.team) : null;
    const defense = counted(teams.get(row.opponent), row.week) ? teams.get(row.opponent) : null;
    for (const [key, read] of Object.entries(GAME_TOTALS)) {
      const value = read(row.stats ?? {});
      if (offense) offense.off[key] += value;
      if (defense) defense.def[key] += value;
    }
  }
  // Players belong to the team they're on now (trades), so starters reflect this
  // week's roster. A released player (no team now) is on nobody's.
  for (const row of stats?.players ?? []) {
    const current = row.player ? row.player.team : row.team;
    if (teams.has(current)) teams.get(current).players.push(row);
  }

  const pct = (made, tries) => (tries ? (100 * made) / tries : 0);
  for (const t of teams.values()) {
    const { off, def, gp } = t;
    t.per = {
      points: per(t.pointsFor, gp),
      passYd: per(off.passYd, off.games),
      rushYd: per(off.rushYd, off.games),
      yards: per(off.passYd + off.rushYd, off.games),
      yardsPerPlay: per(off.passYd + off.rushYd, off.plays),
      thirdPct: pct(off.thirdConv, off.thirdAtt),
      redZonePct: pct(off.rzConv, off.rzAtt),
      allowed: per(t.pointsAgainst, gp),
      oppPassYd: per(def.passYd, def.games),
      oppRushYd: per(def.rushYd, def.games),
      yardsAllowed: per(def.passYd + def.rushYd, def.games),
      oppYardsPerPlay: per(def.passYd + def.rushYd, def.plays),
      oppThirdPct: pct(def.thirdConv, def.thirdAtt),
      oppRedZonePct: pct(def.rzConv, def.rzAtt),
      // A defense's sacks and takeaways are its opponents' sacks taken and giveaways.
      sacks: def.sacked,
      takeaways: def.giveaways,
      giveaways: off.giveaways,
      turnoverMargin: def.giveaways - off.giveaways,
    };
    t.starters = pickStarters(t.players);
  }

  // Rank every team 1..32 on each number (1 = best for that team). Tied teams share a
  // rank: 1 + how many are strictly better. Season counts (sacks, turnovers) rank per
  // game, so a team that's had its bye isn't marked down.
  const COUNTS = new Set(['sacks', 'takeaways', 'giveaways', 'turnoverMargin']);
  const rankOn = (key, higherIsBetter) => {
    const ranked = [...teams.values()].filter((t) => t.gp);
    const score = (t) => (COUNTS.has(key) ? t.per[key] / t.gp : t.per[key]) * (higherIsBetter ? 1 : -1);
    for (const t of ranked) (t.ranks ??= {})[key] = 1 + ranked.filter((o) => score(o) > score(t) + 1e-9).length;
  };
  for (const key of ['points', 'passYd', 'rushYd', 'yards', 'yardsPerPlay', 'thirdPct', 'redZonePct', 'sacks', 'takeaways', 'turnoverMargin']) rankOn(key, true);
  for (const key of ['allowed', 'oppPassYd', 'oppRushYd', 'yardsAllowed', 'oppYardsPerPlay', 'oppThirdPct', 'oppRedZonePct', 'giveaways']) rankOn(key, false);

  return league;
}

// Players who won't suit up this week: skipped so the next man up shows instead.
// Questionable and doubtful players stay, with a tag.
const UNAVAILABLE = new Set(['out', 'ir', 'injured reserve', 'pup', 'sus', 'suspended', 'na', 'nfi', 'cov']);
const available = (p) => !UNAVAILABLE.has(String(p.player?.injury_status ?? '').toLowerCase());

// The expected starters this week: QB, RB, top three WRs, TE, picked by usage (which
// tracks who actually gets the ball better than games started): QB by starts then
// attempts, RB by touches, WR/TE by targets. Unavailable players are skipped.
function pickStarters(players) {
  const stat = (p, k) => p.stats[k] ?? 0;
  const top = (pos, n, score) => players.filter((p) => p.player?.position === pos && available(p)).sort((a, b) => score(b) - score(a)).slice(0, n);
  return [
    ...top('QB', 1, (p) => stat(p, 'gs') * 1000 + stat(p, 'pass_att')),
    ...top('RB', 1, (p) => stat(p, 'rush_att') + stat(p, 'rec_tgt')),
    ...top('WR', 3, (p) => stat(p, 'rec_tgt')),
    ...top('TE', 1, (p) => stat(p, 'rec_tgt')),
  ];
}

/** Opponents both teams have played, with each team's results against them. */
export function commonOpponents(league, a, b) {
  const A = league.teams.get(a);
  const B = league.teams.get(b);
  if (!A || !B) return [];
  const opps = new Set(A.games.map((g) => g.opp).filter((o) => o !== b));
  return [...opps]
    .filter((o) => B.games.some((g) => g.opp === o))
    .map((opp) => ({ opp, a: A.games.filter((g) => g.opp === opp), b: B.games.filter((g) => g.opp === opp) }));
}

/** This season's meetings between the two teams. */
export function headToHead(league, a, b) {
  return league.teams.get(a)?.games.filter((g) => g.opp === b) ?? [];
}

/**
 * Who-beat-whom chains from one team to the other, up to two teams in between:
 * "BUF beat NE, NE beat BAL". Shortest chains first.
 */
export function winChains(league, from, to, maxHops = 3) {
  // One link per beaten team (the latest win), so two wins over a division rival don't
  // make the same chain twice.
  const beat = (x) => [...new Map((league.teams.get(x)?.games ?? []).filter((g) => g.result === 'W').map((g) => [g.opp, g])).values()];
  const chains = [];
  const walk = (path, links) => {
    const last = path.at(-1);
    for (const g of beat(last)) {
      if (path.includes(g.opp)) continue;
      const nextLinks = [...links, { winner: last, loser: g.opp, score: `${g.pf}-${g.pa}`, week: g.week }];
      if (g.opp === to) chains.push(nextLinks);
      else if (nextLinks.length < maxHops) walk([...path, g.opp], nextLinks);
    }
  };
  walk([from], []);
  return chains.sort((x, y) => x.length - y.length);
}

/**
 * A team's résumé, always computable even when two teams share nothing: record against
 * teams with winning records, last three games, home and road splits, average margin.
 */
export function resume(league, abbr) {
  const t = league.teams.get(abbr);
  if (!t) return null;
  const winning = (opp) => {
    const o = league.teams.get(opp);
    return o && o.wins > o.losses;
  };
  const vsWinning = t.games.filter((g) => winning(g.opp));
  const last3 = t.games.slice(-3);
  return {
    vsWinning: recordOf(vsWinning),
    last3: recordOf(last3),
    home: t.homeRecord,
    road: t.roadRecord,
    margin: t.gp ? t.pointDiff / t.gp : 0,
  };
}
