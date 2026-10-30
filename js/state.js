// App state and everything derived from it: the route, the one mutable `state`
// object, and read-only questions about it (who picked what, is it locked, how each
// leg is doing). No DOM and no network here; the rules themselves are in rules.js.
import { gameKey, gradePick, legLockedReason, slipLocked, startsBeforeCutoff } from './rules.js';

// Routes: "<base>/" is the landing page, "<base>/<leagueId>" is that league's slip.
// <base> is "/" locally and "/<repo>/" on GitHub Pages.
const pathParts = location.pathname.replace(/\/index\.html$/, '').split('/').filter(Boolean);
const routeLeagueId = /^\d{6,}$/.test(pathParts.at(-1) ?? '') ? pathParts.pop() : null;
export const basePath = `/${pathParts.join('/')}${pathParts.length ? '/' : ''}`;
export const DEMO = new URLSearchParams(location.search).has('demo');

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
  rungs: new Map(), // "<gameId>:<spread|total>" -> selected line index
  sports: null, // { games, league, teams }: this week's games (sports.loadWeek) and the season so far (research.buildLeague)
  pages: [], // research pages, a stack: { kind: 'team', abbr } or { kind: 'matchup', gameId }
  research: { league: null, loading: false, error: null }, // the season plus Sleeper's stats (research.addStats)
  pastMeetings: new Map(), // "<away>@<home>" -> meetings from the last three seasons, or 'loading'
  resetPageScroll: false,
  seenStickers: new Map(), // sticker id -> when it first showed, so only new ones get slapped on
  stickersPrimed: false, // false until the first board render; stickers there don't animate
  showStarted: false,
  trackOpened: false, // the slip opened itself once this visit because picks are locked or underway
  demoSeeded: false,
  busyKey: null,
  justPicked: null, // the cell you just picked, for its pop animation
  arrival: null, // for one render after a pick: { id, key }, whose avatar peels off which cell (faces.js)
  // Admin page ("?admin"): unlocked for this tab once the password matches. While the
  // admin picks on someone's behalf, `acting` holds who, and who to switch back to.
  admin: { route: new URLSearchParams(location.search).has('admin'), authed: sessionGet('parlay:admin') === '1', error: null },
  acting: null, // { id, prevMe }
  oddsFormat: safeGet('parlay:odds') === 'pct' ? 'pct' : 'american',
  sheetOpen: false,
  // Nudge the closed slip once per visit so people notice it pulls up.
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

function sessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function safeSet(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* private mode */ }
}

export const memberById = (id) => state.slip?.members.find((m) => m.id === id);
export const picks = () => state.slip?.picks ?? {};

export function legsWithLive() {
  if (!state.slip) return [];
  return state.slip.members
    .filter((m) => picks()[m.id])
    .map((m) => {
      const pick = picks()[m.id];
      const live = state.options.get(pick.optKey);
      const game = state.games.find((g) => g.id === pick.gameId);
      const useLive = live && !game?.locked && live.available;
      const price = useLive ? live.price : pick.price;
      const fair = (useLive ? live.fair : pick.fair) ?? price / 100;
      const status = state.sports?.games.get(gameKey(...pick.matchup.split(' @ ')))?.status;
      const started = status && status.state !== 'pre';
      return {
        member: m, pick, price, fair, moved: price !== pick.price, locked: !!game?.locked, status,
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

export const ladderKey = (game, type) => `${game.id}:${type}`;
const rungHas = (rung, key) => [rung.away, rung.home, rung.over, rung.under].some((o) => o?.key === key);

// Which line a spread/total column shows: what the user stepped to, else whoever
// already picked this game + type (so the pick is visible), else the main line.
export function rungIndex(game, type) {
  const key = ladderKey(game, type);
  if (state.rungs.has(key)) return state.rungs.get(key);
  const ladder = game[type];
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

// Spread: away team on top. Total: over on top (sportsbook convention).
export function ladderSides(game, type, index) {
  const rung = game[type].rungs[index];
  return type === 'spread' ? [rung.away, rung.home] : [rung.over, rung.under];
}

// No-vig win chance for the away team, from the two moneylines.
export function awayWinPct(game) {
  const [away, home] = game.ml;
  if (!away?.price || !home?.price) return null;
  return Math.round((100 * away.price) / (away.price + home.price));
}

// Once the first leg's game kicks off (or the slip is locked), the slip switches to
// tracking: live scores, live chances, and hit/miss as games finish.
export const isTracking = (legs) => isLocked() || legs.some((l) => l.status && l.status.state !== 'pre');
