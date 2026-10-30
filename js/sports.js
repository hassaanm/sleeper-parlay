// NFL schedule, scores, and records from Sleeper's own public endpoints (the ones the
// Sleeper app uses). One request per week of scores; everything else is derived.
import { getJson } from './api.js';
import { gameKey } from './rules.js';

const BASE = 'https://api.sleeper.com';

// Sleeper's score rows, cached per season/type/week (finished weeks never change).
// `fresh` refetches, unless the cached copy is under 30 seconds old.
const weekCache = new Map();
function scores(season, week, type = 'regular', { fresh = false } = {}) {
  const key = `${type}:${season}:${week}`;
  const cached = weekCache.get(key);
  if (!cached || (fresh && Date.now() - cached.at > 30_000)) {
    const request = getJson(`${BASE}/scores/nfl/${type}/${season}/${week}`).then((rows) => (Array.isArray(rows) ? rows : [])).catch((e) => {
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
    // The game's prediction events (moneyline, spread, total, ...), still listed here
    // after the lobby drops a finished game (markets.js).
    eventIds: String(m.contract_event_ids ?? '').split(',').filter(Boolean),
    status: {
      state,
      detail,
      awayScore: Number(m.away_score ?? 0),
      homeScore: Number(m.home_score ?? 0),
      possession: m.possession || null,
      redZone: !!m.red_zone,
      downDistance: m.down_and_distance || null,
      spot: m.yard_line ? `${m.yard_line_territory ?? ''} ${m.yard_line}`.trim() : null, // "DEN 34"
      timeouts: [m.away_used_timeouts, m.home_used_timeouts].map((used) => Math.max(0, Math.min(3, 3 - Number(used ?? 0)))),
    },
  };
}

// The regular-season week whose games fall inside [start, end). Sleeper's current-week
// number can lag (or lead) the Tuesday rollover, so `guess` is checked against the
// schedule, then the weeks either side of it. If none of them could be read, this
// throws rather than save an unchecked week for the whole league; the rollover retries.
export async function weekInRange(season, guess, { start, end }) {
  let read = false;
  for (const week of [guess, guess + 1, guess - 1]) {
    if (week < 1) continue;
    const rows = await scores(season, week).catch(() => null);
    if (!rows) continue;
    read = true;
    if (rows.map(toGame).some((g) => g.start >= start && g.start < end)) return week;
  }
  if (!read) throw new Error('Couldn’t load the NFL schedule. Try again in a minute.');
  return guess;
}

// That week's kickoff times in [start, end), earliest first.
export async function kickoffs(season, week, { start, end }) {
  const starts = (await scores(season, week)).map(toGame).map((g) => g.start).filter((t) => t >= start && t < end);
  return [...new Set(starts)].sort((a, b) => a - b);
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
