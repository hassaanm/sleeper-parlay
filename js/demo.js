// "?demo=<mode>": a pretend copy of any league's slip, kept in this browser only
// (store.js never touches the shared slip in demo). Each mode (state.js DEMO_MODES) shows
// the slip at one stage of a week by making up how the week's games are going. Scores
// are picked so each leg lands the way the mode needs, and stay the same every visit.
import { gameKey, gradePick } from './rules.js';
import { seeded } from './ui.js';

// How many league mates the demo gives a leg, and whether you get one too.
export const demoPickers = (mode) => (mode === 'pre' ? { share: 0.5, me: false } : { share: 0.7, me: true });

// Plausible final scores, and smaller ones for a game still going.
const FINAL_SCORES = [0, 3, 6, 7, 10, 13, 14, 16, 17, 20, 21, 23, 24, 27, 28, 30, 31, 34, 35, 38];
const LIVE_SCORES = FINAL_SCORES.filter((n) => n <= 24);

// Which games have started and how each picked game's legs should land, decided once
// per visit, so a pick made later doesn't change it.
let plan = null;
export const resetDemo = () => { plan = null; };

function makePlan(mode, games, picks, liveFirst) {
  const byStart = [...games].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  // Picked games, with `liveFirst` (the game of the league mate with the longest name)
  // moved into a live slot, so the tightest slip row always shows.
  const picked = byStart.filter((g) => picks.some((p) => p.gameId === g.id));
  const at = picked.findIndex((g) => g.id === liveFirst);
  if (at >= 0 && picked.length > 1) picked.splice(1, 0, ...picked.splice(at, 1));
  const done = mode === 'won' || mode === 'lost';
  const result = new Map(); // game id -> { phase: 'in' | 'post', grade: 'hit' | 'miss' | null }
  picked.forEach((g, i) => {
    // Underway, picked games alternate finished and live; once the slip's done, all are over.
    const phase = done || i % 2 === 0 ? 'post' : 'in';
    // The loss modes miss on their first finished game ('lost' on another one too).
    const miss = (mode === 'live-loss' && i === 0) || (mode === 'lost' && (i === 0 || i === 2));
    result.set(g.id, { phase, grade: miss ? 'miss' : 'hit' });
  });
  // The rest of the week fills in: every game over once the slip's done; otherwise
  // about a third final and a quarter live.
  const count = (phase) => [...result.values()].filter((r) => r.phase === phase).length;
  for (const g of byStart) {
    if (result.has(g.id)) continue;
    if (done || count('post') < Math.ceil(games.length * 0.35)) result.set(g.id, { phase: 'post', grade: null });
    else if (count('in') < Math.ceil(games.length * 0.25)) result.set(g.id, { phase: 'in', grade: null });
  }
  return result;
}

// A score where every leg on the game grades the way it should (or any score, for a
// game nobody picked).
function scoreFor(gamePicks, grade, phase, rand) {
  const list = phase === 'post' ? FINAL_SCORES : LIVE_SCORES;
  const pairs = list.flatMap((a) => list.map((b) => [a, b])).map((p) => [rand(), p]).sort((x, y) => x[0] - y[0]).map(([, p]) => p);
  return pairs.find(([a, b]) => !grade || gamePicks.every((p) => gradePick(p, a, b) === grade)) ?? pairs[0];
}

/**
 * Marks the demo's started games locked and gives them made-up scoreboard states:
 * final, or live with a clock, the ball, the down, and timeouts. Does nothing in 'pre'.
 * `scoreboard` is state.sports.games; `picks` the slip's picks; `members` its members.
 */
export function fakeWeek(mode, games, scoreboard, picks, members = []) {
  if (mode === 'pre' || !games.length) return;
  const longest = [...members].filter((m) => picks[m.id]).sort((a, b) => b.name.length - a.name.length)[0];
  plan ??= makePlan(mode, games, Object.values(picks), longest && picks[longest.id].gameId);
  for (const game of games) {
    const how = plan.get(game.id);
    const info = scoreboard.get(gameKey(game.away, game.home));
    if (!how || !info) continue;
    game.locked = true;
    const rand = seeded(game.id);
    const gamePicks = Object.values(picks).filter((p) => p.gameId === game.id);
    const [awayScore, homeScore] = scoreFor(gamePicks, how.grade, how.phase, rand);
    const yards = 1 + Math.floor(rand() * 49);
    info.status = {
      ...info.status, state: how.phase, awayScore, homeScore,
      detail: how.phase === 'post' ? 'Final' : `Q${2 + Math.floor(rand() * 3)} ${Math.floor(rand() * 15)}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`,
      ...(how.phase === 'in' ? {
        possession: rand() < 0.5 ? game.away : game.home,
        downDistance: `${['1st', '2nd', '3rd'][Math.floor(rand() * 3)]} & ${1 + Math.floor(rand() * 10)}`,
        spot: `${rand() < 0.5 ? game.away : game.home} ${yards}`, redZone: yards < 20 && rand() < 0.5,
        timeouts: [1 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 3)],
      } : {}),
    };
  }
}

// A made-up final has no real history: a win-chance line that wanders and ends with
// the winner.
export function fakeMomentum(g) {
  const rand = seeded(`${g.key}:momentum`);
  const end = g.status.awayScore > g.status.homeScore ? 99 : g.status.awayScore < g.status.homeScore ? 1 : 50;
  let p = 50;
  return Array.from({ length: 49 }, (_, i) => {
    p = Math.min(95, Math.max(5, p + (rand() - 0.5) * 18));
    return Math.round(p + ((end - p) * i * i) / (48 * 48));
  });
}

// A made-up past week for the demo's standings and week menu: most league mates take a
// leg on one of that week's real games, with a line set near the real result so some
// legs win big, some lose, and some come down to a point. The same every visit.
export function fakePastWeek(main, week, games) {
  const rand = seeded(`${main.league.id}:${week}`);
  const pickOf = (list) => list[Math.floor(rand() * list.length)];
  const half = (n) => Math.floor(n) + 0.5; // lines end in .5
  const finals = games.filter((g) => g.status.state === 'post');
  const picks = {};
  for (const member of main.members) {
    if (!finals.length || rand() < 0.2) continue;
    const g = pickOf(finals);
    const { awayScore: a, homeScore: h } = g.status;
    const matchup = `${g.away} @ ${g.home}`;
    const type = pickOf(['ml', 'spread', 'spread', 'total']);
    const base = { optKey: `demo:${week}:${member.id}`, gameId: `demo:${g.key}`, type, matchup, start: g.start, pickedAt: g.start - 86_400_000 };
    const fair = 0.25 + rand() * 0.5;
    const price = Math.round(fair * 100);
    if (type === 'total') {
      const line = half(a + h + (rand() - 0.5) * 20);
      const side = rand() < 0.5 ? 'over' : 'under';
      picks[member.id] = { ...base, label: `${side === 'over' ? 'Over' : 'Under'} ${line}`, line, side, price, fair };
    } else {
      const team = rand() < 0.5 ? g.away : g.home;
      const lead = team === g.away ? a - h : h - a; // the team's real winning margin
      if (type === 'ml') picks[member.id] = { ...base, label: `${team} ML`, team, price, fair };
      else {
        const line = Math.max(-13.5, Math.min(13.5, half(-lead + (rand() - 0.5) * 16)));
        picks[member.id] = { ...base, label: `${team} ${line > 0 ? '+' : ''}${line}`, team, line, price, fair };
      }
    }
  }
  const weekStart = main.weekStart - (Number(main.week) - week) * 7 * 86_400_000;
  return {
    league: main.league, season: main.season, week, weekStart, weekEnd: weekStart + 7 * 86_400_000,
    members: main.members, picks, settings: { locked: true }, rev: 1,
  };
}
