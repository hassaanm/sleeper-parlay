// Past weeks: what a week keeps once it ends, and the season's graded legs for the
// standings page. Pure functions of slips and scores, so `node --test` can check them.
import { gameKey, gradePick, pickMargin } from './rules.js';

// Where a finished week is kept in the league's slip: slip.history["<season>-<week>"].
export const weekKey = (season, week) => `${season}-${week}`;

// A finished week as kept: who was in, their legs, and the week's window. It's over,
// so it's locked.
export const archiveOf = (slip) => ({
  league: slip.league,
  season: slip.season,
  week: Number(slip.week),
  weekStart: slip.weekStart,
  weekEnd: slip.weekEnd,
  members: slip.members,
  picks: slip.picks,
  settings: { ...slip.settings, locked: true },
  rev: 1,
});

// The kept weeks of the league's current season, earliest first.
export const pastWeeks = (main) => Object.values(main?.history ?? {})
  .filter((h) => String(h.season) === String(main.season) && Number(h.week) < Number(main.week))
  .sort((a, b) => a.week - b.week);

// Every leg whose game is final, from [{ slip, games }], where `games` is that week's
// scoreboard keyed "AWAY@HOME" (sports.loadWeek). Margin is in points: positive is a
// hit by that much, negative a miss (rules.js pickMargin).
export function gradedLegs(weeks) {
  return weeks.flatMap(({ slip, games }) => Object.entries(slip.picks ?? {}).flatMap(([memberId, pick]) => {
    const [away, home] = pick.matchup.split(' @ ');
    const game = games.get(gameKey(away, home));
    if (game?.status.state !== 'post') return [];
    const { awayScore, homeScore } = game.status;
    return [{
      week: Number(slip.week), memberId, pick, away, home, awayScore, homeScore,
      margin: pickMargin(pick, awayScore, homeScore),
      grade: gradePick(pick, awayScore, homeScore),
    }];
  })).sort((a, b) => a.week - b.week || a.pick.start - b.pick.start);
}

// A leg within this many points of its line, either way, was close.
export const CLOSE = 3;

const average = (list) => (list.length ? list.reduce((s, n) => s + n, 0) / list.length : null);

// A leg's chance of hitting when it was picked: its no-vig market chance.
export const chanceOf = (pick) => pick.fair ?? pick.price / 100;

// The leaderboard. Each member's score is how far they beat the odds: hits minus the
// hits their picks were expected to make (the sum of each leg's chance when picked),
// so a 40% pick that hits counts for more than a 70% one. Pushes count neither way.
// Highest score first; the bigger average margin breaks a tie. Members level on score
// (to a tenth) share a rank.
export function standings(legs) {
  const rows = new Map();
  for (const l of legs) {
    if (!rows.has(l.memberId)) rows.set(l.memberId, { memberId: l.memberId, hits: 0, misses: 0, pushes: 0, expected: 0, legs: [] });
    const r = rows.get(l.memberId);
    if (l.grade === 'hit') r.hits++;
    else if (l.grade === 'miss') r.misses++;
    else r.pushes++;
    if (l.grade !== 'push') r.expected += chanceOf(l.pick);
    r.legs.push(l);
  }
  const tenth = (n) => Math.round(n * 10) / 10;
  const list = [...rows.values()].map((r) => ({
    ...r,
    score: tenth(r.hits - r.expected),
    pct: r.hits + r.misses ? r.hits / (r.hits + r.misses) : null,
    avgChance: average(r.legs.map((l) => chanceOf(l.pick))),
    avgMargin: average(r.legs.map((l) => l.margin)),
    close: r.legs.filter((l) => Math.abs(l.margin) <= CLOSE).length,
  })).sort((a, b) => b.score - a.score || b.avgMargin - a.avgMargin);
  list.forEach((r, i) => {
    const prev = list[i - 1];
    r.rank = prev && prev.score === r.score ? prev.rank : i + 1;
  });
  return list;
}

// How each week's slip did: legs graded, hits and misses, whether it cashed (every
// leg hit or pushed, none still to play), and who missed.
export function weekResults(slips, legs) {
  return slips.map((slip) => {
    const week = Number(slip.week);
    const mine = legs.filter((l) => l.week === week);
    const total = Object.keys(slip.picks ?? {}).length;
    const misses = mine.filter((l) => l.grade === 'miss');
    return {
      week,
      total,
      hits: mine.filter((l) => l.grade === 'hit').length,
      misses: misses.length,
      pending: total - mine.length,
      cashed: total > 0 && mine.length === total && misses.length === 0,
      missedBy: misses.map((l) => l.memberId),
    };
  }).sort((a, b) => b.week - a.week);
}

// A week's standout legs: the biggest cover, the closest hit, the closest miss, the
// widest miss, the least likely hit (by its no-vig chance when picked), and the slip
// killer (the first miss to kick off; on a tie, the wider miss).
export function highlights(legs) {
  const hits = legs.filter((l) => l.grade === 'hit');
  const misses = legs.filter((l) => l.grade === 'miss');
  const best = (list, score) => list.reduce((top, l) => (top && score(top) >= score(l) ? top : l), null);
  return {
    biggest: best(hits, (l) => l.margin),
    closest: best(hits, (l) => -l.margin),
    heartbreak: best(misses, (l) => l.margin),
    longshot: best(hits, (l) => -chanceOf(l.pick)),
    brick: best(misses, (l) => -l.margin),
    killer: best(misses, (l) => -l.pick.start * 1000 - l.margin),
  };
}

// Everyone who's played this season, by id, with the name and picture from their
// latest week.
export function seasonMembers(slips) {
  const members = new Map();
  for (const slip of [...slips].sort((a, b) => a.week - b.week)) {
    for (const m of slip.members ?? []) members.set(m.id, m);
  }
  return members;
}
