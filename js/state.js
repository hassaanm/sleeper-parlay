// App state and everything derived from it: the route, the one mutable `state`
// object, and read-only questions about it (who picked what, is it locked, how each
// leg is doing). No DOM and no network here; the rules themselves are in rules.js.
import { ladderKey } from './lines.js';
import { clashFor, gameKey, gradePick, legLockedReason, pickBlockedReason, slipLocked, startsBeforeCutoff } from './rules.js';

// Routes: "<base>/" is the landing page, "<base>/<leagueId>" is that league's slip.
// <base> is "/" locally and "/<repo>/" on GitHub Pages.
const pathParts = location.pathname.replace(/\/index\.html$/, '').split('/').filter(Boolean);
const routeLeagueId = /^\d{6,}$/.test(pathParts.at(-1) ?? '') ? pathParts.pop() : null;
export const basePath = `/${pathParts.join('/')}${pathParts.length ? '/' : ''}`;
export const DEMO = new URLSearchParams(location.search).has('demo');
// The demo's stages of a week (demo.js), picked from the top bar: "?demo=<id>".
export const DEMO_MODES = [
  { id: 'pre', label: 'Pre' }, // half your league mates have picked; you haven't
  { id: 'live-win', label: 'Live ✓' }, // games underway, every leg winning so far
  { id: 'live-loss', label: 'Live ✗' }, // games underway, a leg already missed
  { id: 'won', label: 'Won' }, // every game over, every leg hit
  { id: 'lost', label: 'Lost' }, // every game over, some legs missed
];
const demoParam = new URLSearchParams(location.search).get('demo');
export const DEMO_MODE = !DEMO ? null
  : DEMO_MODES.some((m) => m.id === demoParam) ? demoParam : demoParam === 'live' ? 'live-win' : 'pre';

export const state = {
  slipId: routeLeagueId,
  slip: undefined, // undefined = loading, null = failed to load
  loadError: null,
  lobby: null,
  games: [],
  options: new Map(),
  gamesError: null,
  me: null,
  switchingUser: false,
  rungs: new Map(), // "<gameId>:<spread|total>" -> the line swiped to, by its top side's option key
  sports: null, // { games, league, teams }: this week's games (sports.loadWeek) and the season so far (research.buildLeague)
  pages: [], // research pages, a stack: { kind: 'team', abbr } or { kind: 'matchup', gameId }
  research: { league: null, loading: false, error: null }, // the season plus Sleeper's stats (research.addStats)
  pastMeetings: new Map(), // "<away>@<home>" -> meetings from the last three seasons, or 'loading'
  resetPageScroll: false,
  pickSince: new Map(), // "<member>:<optKey>" -> when that pick appeared (0 = already there on load); new ones' stickers slap on
  stickersPrimed: false, // false until the first board render; picks there don't animate
  prices: new Map(), // "<away>@<home>" -> a started game's lines (markets.js): live now, or at kickoff once final
  trackOpened: false, // the slip opened itself once this visit because picks are locked or underway
  demoSeeded: false,
  pending: null, // your leg while its save is in flight: { userId, pick } (pick null = removed); see picks()
  justPicked: null, // the cell you just picked, for its pop animation
  // Admin page ("?admin"): unlocked once the password matches, until the page is left or
  // reloaded (every visit asks again). While the admin picks on someone's behalf,
  // `acting` holds who, and who to switch back to.
  admin: { route: new URLSearchParams(location.search).has('admin'), authed: false, error: null },
  acting: null, // { id, prevMe }
  oddsFormat: safeGet('parlay:odds') === 'pct' ? 'pct' : 'american',
  sheetOpen: false,
  // Nudge the closed slip once per browser so people notice it pulls up.
  slipNudge: safeGet('parlay:nudged') !== '1',
  nudging: false,
  tear: {}, // where each slip's tear line sits, in px from the bottom: { slip, ticket }
  failedImages: new Set(), // player headshots that failed to load, kept hidden
  landing: { query: '', error: null },
  toast: null,
};

export const isLocked = () => slipLocked(state.slip);
export const beforeCutoff = (game) => !!game && startsBeforeCutoff(state.slip, game.start);
// The admin, picking for someone, can change any leg; everyone else follows the rules.
export const myLegLocked = () => !state.acting && !!legLockedReason(state.slip, state.me);

export function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function safeSet(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* private mode */ }
}

export const memberById = (id) => state.slip?.members.find((m) => m.id === id);
// A member's name for messages, from `slip` (default: the one on screen).
export const memberName = (id, slip = state.slip) => slip?.members.find((m) => m.id === id)?.name ?? 'Someone';
export const gameById = (id) => state.games.find((g) => g.id === id);
// Everyone's picks. A change to your own leg shows as soon as you tap (state.pending),
// before its save comes back.
export function picks() {
  const saved = state.slip?.picks ?? {};
  const p = state.pending;
  if (!p) return saved;
  const all = { ...saved };
  if (p.pick) all[p.userId] = p.pick;
  else delete all[p.userId];
  return all;
}

// Why the current member can't take `opt` right now, in words, or null if they can. The
// board greys out a cell with a problem, and tapping it shows this (app.js choose).
export function pickProblem(opt) {
  const game = gameById(opt.gameId);
  if (!game) return 'That line is closed.';
  const clash = clashFor(state.slip, state.me, opt);
  if (clash) return `${memberName(clash.userId)} already has ${clash.pick.label}.`;
  return pickBlockedReason(state.slip, state.me, game.start, { admin: !!state.acting })
    ?? (game.locked || !opt.available ? 'That line is closed.' : null);
}

export function legsWithLive() {
  if (!state.slip) return [];
  return state.slip.members
    .filter((m) => picks()[m.id])
    .map((m) => {
      const pick = picks()[m.id];
      const live = state.options.get(pick.optKey);
      const game = gameById(pick.gameId);
      const useLive = live && !game?.locked && live.available;
      const price = useLive ? live.price : pick.price;
      const fair = (useLive ? live.fair : pick.fair) ?? price / 100;
      const status = state.sports?.games.get(gameKey(...pick.matchup.split(' @ ')))?.status;
      const started = status && status.state !== 'pre';
      return {
        member: m, pick, price, fair, status,
        // While live: is it covering right now? After the final: hit, miss, or push.
        grade: started ? gradePick(pick, status.awayScore, status.homeScore) : null,
        // The market keeps trading during the game, so its price is a live chance.
        livePrice: status?.state === 'in' && live?.available ? live.price : null,
        liveFair: status?.state === 'in' && live?.available ? live.fair : null,
      };
    })
    // By kickoff, then by game (in board order), so legs on the same game sit together.
    .sort((a, b) => a.pick.start - b.pick.start || a.pick.matchup.localeCompare(b.pick.matchup)
      || TYPE_ORDER.indexOf(a.pick.type) - TYPE_ORDER.indexOf(b.pick.type));
}
const TYPE_ORDER = ['ml', 'spread', 'total'];

const rungHas = (rung, key) => [rung.away, rung.home, rung.over, rung.under].some((o) => o?.key === key);

// Which line a spread/total column shows: what the user swiped to, else whoever
// already picked this game + type (so the pick is visible), else the main line. The
// swiped line is kept by market, so lines opening or closing around it don't move the
// column; if its own market closes, the column falls back.
export function rungIndex(game, type) {
  const ladder = game[type];
  const swiped = state.rungs.get(ladderKey(game, type));
  const at = swiped ? ladder.rungs.findIndex((r) => rungHas(r, swiped)) : -1;
  if (at >= 0) return at;
  const ordered = Object.entries(picks()).sort(([uid]) => (uid === state.me ? -1 : 1));
  for (const [, pick] of ordered) {
    if (pick.gameId !== game.id || pick.type !== type) continue;
    const i = ladder.rungs.findIndex((r) => rungHas(r, pick.optKey));
    if (i >= 0) return i;
  }
  return ladder.mainIndex;
}

export function gameTakers(game) {
  return Object.entries(picks())
    .filter(([, p]) => p.gameId === game.id)
    .map(([uid, p]) => ({ member: memberById(uid), pick: p, mine: uid === state.me }));
}

// Once the first leg's game kicks off (or the slip is locked), the slip switches to
// tracking: live scores, live chances, and hit/miss as games finish.
// A game on the scoreboard, and whether it's kicked off ('pre' until scores load).
export const scoreboardGame = (away, home) => state.sports?.games.get(gameKey(away, home));
export const hasStarted = (game) => (scoreboardGame(game.away, game.home)?.status.state ?? 'pre') !== 'pre';
// This week's scoreboard games in one state ('in' or 'post'), by kickoff.
export const scoreboardGames = (phase) => [...(state.sports?.games.values() ?? [])]
  .filter((g) => g.status.state === phase)
  .sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));

export const isTracking = (legs) => isLocked() || legs.some((l) => l.status && l.status.state !== 'pre');
