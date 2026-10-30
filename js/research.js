// Turns a season of results into per-team profiles (record, splits, form, standing),
// then adds Sleeper's season stats (per-game numbers, league ranks, starters) when a
// research page needs them. Also finds common opponents and who-beat-whom chains
// between two teams.
import { DIVISIONS, divisionOf } from './teams.js';

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
    t.division = divisionOf(t.abbr);
  }

  // Division rank: win percentage, then point differential.
  for (const [division, members] of Object.entries(DIVISIONS)) {
    const pct = (t) => t.wins / Math.max(1, t.wins + t.losses);
    const ranked = members.map((a) => teams.get(a)).filter(Boolean).sort((a, b) => pct(b) - pct(a) || b.pointDiff - a.pointDiff);
    ranked.forEach((t, i) => (t.standing = `${['1st', '2nd', '3rd', '4th'][i]} in ${division}`));
  }

  return { teams, size: [...teams.values()].filter((t) => t.gp).length, hasStats: false };
}

/**
 * Adds Sleeper's season stats to a league from buildLeague: per-game numbers, a 1..32
 * league rank on each, and this week's expected starters.
 * stats: { offense: Sleeper player rows, defense: Sleeper DEF rows }
 */
export function addStats(league, stats) {
  const { teams } = league;
  for (const t of teams.values()) Object.assign(t, { passYd: 0, rushYd: 0, players: [], defense: null });

  for (const row of stats?.offense ?? []) {
    // Yards count for the team they were gained with; the player belongs to the team
    // he's on now (trades), so starters reflect this week's roster.
    if (teams.has(row.team)) {
      const t = teams.get(row.team);
      t.passYd += row.stats.pass_yd ?? 0;
      t.rushYd += row.stats.rush_yd ?? 0;
    }
    const current = row.player?.team ?? row.team;
    if (teams.has(current)) teams.get(current).players.push(row);
  }
  for (const row of stats?.defense ?? []) {
    const t = teams.get(row.player_id);
    if (!t) continue;
    const s = row.stats;
    t.defense = { yardsAllowed: s.yds_allow ?? 0, sacks: s.sack ?? 0, takeaways: (s.int ?? 0) + (s.fum_rec ?? 0) };
  }

  for (const t of teams.values()) {
    const gp = t.gp;
    t.per = {
      points: per(t.pointsFor, gp),
      allowed: per(t.pointsAgainst, gp),
      passYd: per(t.passYd, gp),
      rushYd: per(t.rushYd, gp),
      yards: per(t.passYd + t.rushYd, gp),
      yardsAllowed: per(t.defense?.yardsAllowed ?? 0, gp),
      sacks: t.defense?.sacks ?? 0,
      takeaways: t.defense?.takeaways ?? 0,
    };
    t.starters = pickStarters(t.players);
  }

  // Rank every team 1..32 on each number (1 = best for that team).
  const rankOn = (key, higherIsBetter) => {
    const sorted = [...teams.values()].filter((t) => t.gp).sort((a, b) => (higherIsBetter ? b.per[key] - a.per[key] : a.per[key] - b.per[key]));
    sorted.forEach((t, i) => ((t.ranks ??= {})[key] = i + 1));
  };
  rankOn('points', true);
  rankOn('allowed', false);
  rankOn('passYd', true);
  rankOn('rushYd', true);
  rankOn('yards', true);
  rankOn('yardsAllowed', false);
  rankOn('sacks', true);
  rankOn('takeaways', true);

  league.hasStats = true;
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
  const beat = (x) => (league.teams.get(x)?.games ?? []).filter((g) => g.result === 'W');
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
    vsWinningGames: vsWinning.length,
    last3: recordOf(last3),
    last3Points: last3.length ? last3.reduce((sum, g) => sum + g.pf, 0) / last3.length : 0,
    home: t.homeRecord,
    road: t.roadRecord,
    margin: t.gp ? t.pointDiff / t.gp : 0,
  };
}
