// NFL schedule, scores, and records from Sleeper's own public endpoints (the ones the
// Sleeper app uses). One request per week of scores; everything else is derived.
import { getJson } from './api.js';
import { gameKey } from './rules.js';
import { DIVISIONS, divisionOf } from './teams.js';

const BASE = 'https://api.sleeper.com';


// Sleeper's score rows, cached per season/type/week (finished weeks never change).
// `fresh` refetches, unless the cached copy is under 30 seconds old.
const weekCache = new Map();
function scores(season, week, type = 'regular', { fresh = false } = {}) {
  const key = `${type}:${season}:${week}`;
  const cached = weekCache.get(key);
  if (!cached || (fresh && Date.now() - cached.at > 30_000)) {
    const request = getJson(`${BASE}/scores/nfl/${type}/${season}/${week}`).catch((e) => {
      weekCache.delete(key);
      throw e;
    });
    weekCache.set(key, { request, at: Date.now() });
  }
  return weekCache.get(key).request;
}

// Season schedules, cached: used to find past meetings between two teams.
const scheduleCache = new Map();
function schedule(year, type) {
  const key = `${type}:${year}`;
  if (!scheduleCache.has(key)) {
    scheduleCache.set(key, getJson(`${BASE}/schedule/nfl/${type}/${year}`).catch(() => {
      scheduleCache.delete(key); // try again next time
      return [];
    }));
  }
  return scheduleCache.get(key);
}

// One game, normalized: who, when, where it's watched, and where it stands.
function toGame(row) {
  const m = row.metadata ?? {};
  const state = m.is_over || row.status === 'complete' ? 'post' : row.status === 'in_game' || m.is_in_progress ? 'in' : 'pre';
  const clock = String(m.time_remaining ?? '').replace(/^0(?=\d:)/, '');
  const detail = state === 'post' ? (m.is_overtime ? 'Final/OT' : 'Final')
    : state === 'in' ? (m.quarter === 'H' ? 'Half' : `${m.is_overtime ? 'OT' : `Q${m.quarter_num || m.quarter}`} ${clock}`.trim())
    : '';
  const stadium = m.stadium_details?.type ?? '';
  return {
    key: gameKey(m.away_team, m.home_team),
    away: m.away_team,
    home: m.home_team,
    week: Number(row.week),
    season: Number(row.season),
    start: row.start_time ?? Date.parse(m.date_time),
    tv: m.channel || null,
    dome: stadium === 'dome' || stadium === 'retractable_dome',
    weather: m.forecast_description ? { text: m.forecast_description, temp: m.forecast_temp_high, wind: m.forecast_wind_speed } : null,
    status: {
      state,
      detail,
      awayScore: Number(m.away_score ?? 0),
      homeScore: Number(m.home_score ?? 0),
      possession: m.possession || null,
      redZone: !!m.red_zone,
      downDistance: m.down_and_distance || null,
    },
  };
}

// The regular-season week whose games fall inside [start, end). Sleeper's current-week
// number can lag (or lead) the Tuesday rollover, so `guess` is checked against the
// schedule, then the weeks either side of it.
export async function weekInRange(season, guess, { start, end }) {
  for (const week of [guess, guess + 1, guess - 1]) {
    if (week < 1) continue;
    const rows = await scores(season, week).catch(() => []);
    if (rows.map(toGame).some((g) => g.start >= start && g.start < end)) return week;
  }
  return guess;
}

/** This week's games keyed "AWAY@HOME". */
export async function loadWeek(season, week, { fresh = false } = {}) {
  const rows = await scores(season, week, 'regular', { fresh });
  return new Map(rows.map(toGame).map((g) => [g.key, g]));
}

/**
 * Every finished game this season through `week`, as results:
 * [{ week, home, away, homeScore, awayScore }].
 */
export async function loadSeasonResults(season, week) {
  const weeks = await Promise.all(
    Array.from({ length: week }, (_, i) => scores(season, i + 1, 'regular', { fresh: i + 1 === week }).catch(() => [])),
  );
  return weeks.flat().map(toGame).filter((g) => g.status.state === 'post').map((g) => ({
    week: g.week, home: g.home, away: g.away, homeScore: g.status.homeScore, awayScore: g.status.awayScore,
  }));
}

/**
 * Per-team summary from this season's results: record, home/road, last five, streak,
 * and division standing.
 */
export function summarizeTeams(results) {
  const teams = new Map();
  const team = (abbr) => {
    if (!teams.has(abbr)) teams.set(abbr, { abbr, games: [] });
    return teams.get(abbr);
  };
  for (const g of results) {
    team(g.home).games.push({ week: g.week, opp: g.away, home: true, pf: g.homeScore, pa: g.awayScore });
    team(g.away).games.push({ week: g.week, opp: g.home, home: false, pf: g.awayScore, pa: g.homeScore });
  }
  const rec = (games) => {
    const w = games.filter((g) => g.pf > g.pa).length;
    const l = games.filter((g) => g.pf < g.pa).length;
    const t = games.length - w - l;
    return { w, l, t, text: `${w}-${l}${t ? `-${t}` : ''}` };
  };
  for (const t of teams.values()) {
    t.games.sort((a, b) => a.week - b.week);
    const all = rec(t.games);
    t.wins = all.w;
    t.losses = all.l;
    t.record = all.text;
    t.homeRecord = rec(t.games.filter((g) => g.home)).text;
    t.roadRecord = rec(t.games.filter((g) => !g.home)).text;
    t.lastFive = t.games.slice(-5).reverse().map((g) => ({ won: g.pf > g.pa, tie: g.pf === g.pa, score: `${g.pf}-${g.pa}`, opp: g.opp, home: g.home, week: g.week }));
    const last = t.games.at(-1);
    if (last) {
      const kind = last.pf > last.pa ? 'W' : last.pf < last.pa ? 'L' : 'T';
      let n = 0;
      for (let i = t.games.length - 1; i >= 0; i--) {
        const g = t.games[i];
        if ((g.pf > g.pa ? 'W' : g.pf < g.pa ? 'L' : 'T') !== kind) break;
        n++;
      }
      t.streak = `${kind}${n}`;
    }
    t.pointDiff = t.games.reduce((sum, g) => sum + g.pf - g.pa, 0);
    t.division = divisionOf(t.abbr);
  }
  // Division rank: win percentage, then point differential.
  for (const [division, members] of Object.entries(DIVISIONS)) {
    const ranked = members.map((a) => teams.get(a)).filter(Boolean)
      .sort((a, b) => b.wins / Math.max(1, b.wins + b.losses) - a.wins / Math.max(1, a.wins + a.losses) || b.pointDiff - a.pointDiff);
    ranked.forEach((t, i) => (t.standing = `${['1st', '2nd', '3rd', '4th'][i]} in ${division}`));
  }
  return teams;
}

/**
 * Meetings between two teams in the previous `seasons` seasons (regular + playoffs),
 * newest first: the schedule finds the weeks, then only those weeks' scores load.
 */
export async function loadPastMeetings(a, b, season, seasons = 3) {
  const lookups = [];
  for (let year = season - 1; year >= season - seasons; year--) {
    for (const type of ['regular', 'post']) {
      lookups.push(schedule(year, type).then((rows) => ({ year, type, rows })));
    }
  }
  const meetings = (await Promise.all(lookups)).flatMap(({ year, type, rows }) => rows
    .filter((row) => (row.home === a && row.away === b) || (row.home === b && row.away === a))
    .map((row) => ({ year, type, row })));
  const games = await Promise.all(meetings.map(async ({ year, type, row }) => {
    const weekRows = await scores(year, row.week, type).catch(() => []);
    const g = weekRows.map(toGame).find((x) => x.home === row.home && x.away === row.away);
    return g?.status.state === 'post' ? { ...g, playoff: type === 'post' } : null;
  }));
  return games.filter(Boolean).sort((x, y) => y.start - x.start);
}
