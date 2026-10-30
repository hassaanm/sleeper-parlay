// Entry point: loads data, handles actions and events, and renders the views into #app.
import * as api from './api.js';
import * as store from './store.js';
import * as sports from './sports.js';
import * as markets from './markets.js';
import { demoPickers, fakeMomentum, fakeWeek, resetDemo } from './demo.js';
import { addStats, buildLeague } from './research.js';
import { buildGames, indexOptions, ladderSides, weekWindowAt } from './lines.js';
import { clashFor, defaultCutoff, gameKey, legLockedReason, pickBlockedReason, pickFrom, slipLocked } from './rules.js';
import { ADMIN_PASSWORD_SHA256 } from './config.js';
import { patch } from './dom.js';
import { animateFaces, captureFaces } from './faces.js';
import { holdRender, initSheet, setSlipOpen, syncScrollLock, syncTearLine } from './sheet.js';
import { DEMO, basePath, gameById, isTracking, legsWithLive, memberName, pickProblem, picks, rungIndex, safeGet, safeSet, scoreboardGames, state } from './state.js';
import { dayTimeFmt, pretty } from './ui.js';
import { STRIP_ITEM, cell, clockParts, clockTiles } from './views/board.js';
import { renderApp } from './views/shell.js';

const $app = document.getElementById('app');

// ---------- helpers ----------

// A failed save, in words. fetch rejects with a TypeError ("Failed to fetch", "Load
// failed") when the network is down, and store.js gives up on hung requests.
const saveError = (e) => (e?.name === 'TimeoutError' || (e instanceof TypeError && /fetch|load|network/i.test(e.message))
  ? 'Couldn’t reach the server. Check your connection and try again.'
  : e.message);

// Takes a slip from a push, a save, or a read, if it's newer than the one on screen
// (not the echo of our own save, or a slow read). A slip for a new week also drops last
// week's lines, alt-line choices, scores, and season numbers, and loads the new ones.
// True if it was taken.
function setSlip(slip) {
  const current = state.slip;
  if (current && slip && (slip.rev ?? 0) <= (current.rev ?? 0)) return false;
  const firstLoad = current === undefined;
  const weekChanged = current && slip && current.weekStart !== slip.weekStart;
  // A new or changed pick shows on its line, even in a column you'd swiped elsewhere.
  for (const [uid, pick] of Object.entries(slip?.picks ?? {})) {
    if (current?.picks?.[uid]?.optKey !== pick.optKey) state.rungs.delete(`${pick.gameId}:${pick.type}`); // see ladderKey
  }
  state.slip = slip;
  if (firstLoad) state.me = rememberedMe(slip);
  if (weekChanged) {
    state.lobby = null;
    state.games = [];
    state.options = new Map();
    state.gamesError = null;
    state.rungs.clear();
    state.sports = null;
    state.sportsFailed = false;
    state.prices = new Map();
    state.research = { league: null, loading: false, error: null };
    state.trackOpened = false;
  }
  if (firstLoad || weekChanged) {
    loadLines();
    loadSports();
  }
  return true;
}

// A slip returned by a save or read (null when a read failed).
const acceptSlip = (slip) => slip && setSlip(slip);

// This slip's season and week, as numbers for the scores and stats endpoints.
const slipWeek = () => ({ season: Number(state.slip.season), week: Number(state.slip.week) });

function toast(message, tone = 'info') {
  state.toast = { message, tone, id: Date.now() };
  render();
  const id = state.toast.id;
  setTimeout(() => {
    if (state.toast?.id === id) {
      state.toast = null;
      render();
    }
  }, 3200);
}

// ---------- data loading ----------

let linesRequest = 0;
async function loadLines() {
  if (!state.slip) return;
  // A slow response from an older refresh must not overwrite a newer one.
  const request = ++linesRequest;
  try {
    const lobby = state.lobby ?? (await api.fetchLobby());
    const week = { start: state.slip.weekStart, end: state.slip.weekEnd };
    const ids = buildGames(lobby, new Map(), week).flatMap((g) => [g.id, ...g.relatedIds]);
    const events = await api.fetchEvents(ids);
    if (request !== linesRequest) return;
    state.lobby = lobby;
    const games = buildGames(lobby, new Map(events.map((e) => [e.event_id, e])), week);
    state.games = games;
    state.options = indexOptions(games);
    state.gamesError = null;
    if (state.slipNudge) setTimeout(nudgeSlip, 300);
    if (DEMO && !state.demoSeeded) {
      state.demoSeeded = true;
      await seedDemoPicks();
    }
    fakeDemoWeek();
    if (DEMO && state.demoMode !== 'pre') loadStartedPrices();
  } catch (e) {
    if (request !== linesRequest) return;
    state.gamesError = e.message;
  }
  render();
  openIfTracking();
}

// The demo gives some of your league mates a random leg (and you one too, past the
// 'pre' stage), following the same conflict rules. Demo slips live in this browser only.
async function seedDemoPicks() {
  const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  // Moneylines and main spread/total lines only, so the demo looks like real picks.
  const open = state.games
    .filter((g) => !g.locked)
    .flatMap((g) => {
      const spread = g.spread?.rungs[g.spread.mainIndex];
      const total = g.total?.rungs[g.total.mainIndex];
      return [...g.ml, spread?.away, spread?.home, total?.over, total?.under];
    })
    .filter((o) => o?.available);
  const { share, me } = demoPickers(state.demoMode);
  let added = 0;
  acceptSlip(await store.updateSlip(state.slipId, (slip) => {
    const mates = slip.members.filter((m) => m.id !== state.me);
    const target = Math.floor(mates.length * share) - mates.filter((m) => slip.picks[m.id]).length;
    const pickers = shuffle(mates.filter((m) => !slip.picks[m.id])).slice(0, Math.max(0, target));
    if (me && state.me && !slip.picks[state.me]) pickers.push(slip.members.find((m) => m.id === state.me));
    for (const member of pickers) {
      const opt = shuffle(open).find((o) => !clashFor(slip, member.id, o));
      if (!opt) break;
      slip.picks[member.id] = pickFrom(opt, gameById(opt.gameId));
      added++;
    }
    // Past 'pre', the week is underway, so picks are locked.
    if (state.demoMode !== 'pre') slip.settings.locked = true;
  }));
  if (added) toast(`Demo: added ${added} picks`, 'good');
}

// Moves the demo to another stage in place (a reload would flash the whole page): a
// fresh demo slip, fresh scores and lines, then that stage's picks and made-up games.
// The board stays up, dimmed, while it loads.
async function switchDemoStage(mode) {
  const url = new URL(location.href);
  url.searchParams.set('demo', mode);
  history.replaceState(null, '', url);
  state.demoMode = mode;
  state.demoSwitching = true;
  render(); // the pill pulses and the board dims...
  state.demoSwitching = 'loading'; // ...and stays as it was until the new stage is ready
  safeSet(`parlay:demo-mode:${state.slipId}`, mode);
  store.clearLocalSlip(state.slipId);
  resetDemo();
  Object.assign(state, { games: [], options: new Map(), prices: new Map(), demoSeeded: false, trackOpened: false });
  setSlipOpen(false);
  try {
    await ensureCurrentSlip();
    state.slip = await store.getSlip(state.slipId); // a new slip starts over at rev 1
    await loadSports(); // fresh scoreboard states before the lines (and picks) come back
    await loadLines();
  } finally {
    state.demoSwitching = false;
    render();
  }
}

// Past the 'pre' stage, the demo makes up how this week's games are going (demo.js).
function fakeDemoWeek() {
  if (DEMO && state.sports) fakeWeek(state.demoMode, state.games, state.sports.games, picks(), state.slip?.members);
}

// Prices for games that have kicked off (markets.js): every live game's, on each
// refresh; each finished game's once, then kept in this browser, since they never change.
async function loadStartedPrices() {
  const live = scoreboardGames('in');
  const final = scoreboardGames('post');
  // The demo's made-up started games haven't begun: today's prices stand in.
  const madeUp = (g) => DEMO && g.start > Date.now();
  const current = [...live, ...final.filter(madeUp)];
  if (current.length) {
    try {
      const now = await markets.livePrices(current);
      for (const g of current) {
        const lines = now.get(g.key);
        state.prices.set(g.key, lines && g.status.state === 'post' ? { ...lines, momentum: fakeMomentum(g) } : lines);
      }
    } catch { /* keep the last prices; try again next refresh */ }
  }
  await Promise.all(final.filter((g) => !madeUp(g) && !state.prices.get(g.key)?.final).map(async (g) => {
    const saved = `parlay:kickoff:${g.season}:${g.week}:${g.key}`;
    try {
      const lines = JSON.parse(safeGet(saved) ?? 'null') ?? (await markets.kickoffPrices(g));
      safeSet(saved, JSON.stringify(lines));
      state.prices.set(g.key, { ...lines, final: true });
    } catch { /* shown without prices; tried again on the next refresh */ }
  }));
  render();
}

async function startSlip() {
  // Each demo stage starts from a fresh slip, so switching stages shows that stage.
  if (DEMO && safeGet(`parlay:demo-mode:${state.slipId}`) !== state.demoMode) {
    store.clearLocalSlip(state.slipId);
    safeSet(`parlay:demo-mode:${state.slipId}`, state.demoMode);
  }
  try {
    await ensureCurrentSlip();
  } catch (e) {
    state.slip = null;
    state.loadError = e.message;
    return render();
  }
  store.watchSlip(state.slipId, (slip) => {
    if (!setSlip(slip)) return;
    render();
    openIfTracking();
  });
  setInterval(refreshLive, 60_000);
  // Prices move; refresh the full events every 45s and the lobby every 5 min. A tab left
  // open past the end of the week rolls the slip over itself.
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (state.slip && Date.now() >= state.slip.weekEnd) ensureCurrentSlip().catch(() => {});
    loadLines();
  }, 45_000);
  setInterval(() => (state.lobby = null), 5 * 60_000);
  setInterval(tickClocks, 1000);
  // Back from the background: games may have kicked off and prices moved.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    loadLines();
    refreshLive();
  });
}

// This week's games (TV, weather, live scores) and every team's record, streak, and
// last five, from Sleeper's scores endpoints.
let sportsRequest = 0;
async function loadSports() {
  // A slow load from before a week change must not overwrite the new week's.
  const request = ++sportsRequest;
  try {
    const { season, week } = slipWeek();
    const [games, results] = await Promise.all([sports.loadWeek(season, week), sports.loadSeasonResults(season, week)]);
    if (request !== sportsRequest) return;
    const league = buildLeague(results);
    state.sports = { games, league, teams: league.teams };
    fakeDemoWeek();
    render();
    openIfTracking();
    loadStartedPrices();
  } catch {
    // Records and weather are extras; the slip works without them.
    if (request !== sportsRequest) return;
    state.sportsFailed = true;
    render();
  }
}

// Once picks lock or the parlay is underway, open straight into the slip to follow
// along (once per visit; it can still be slid down to see the board).
function openIfTracking() {
  if (state.trackOpened || !state.sports || state.admin.route || !isTracking(legsWithLive())) return;
  state.trackOpened = true;
  setSlipOpen(true);
}

// Your Sleeper user ID is the same in every league, so one remembered choice
// carries over to any league you're in.
function rememberedMe(slip) {
  const isMember = (id) => id && slip?.members.some((m) => m.id === id);
  const perLeague = safeGet(`parlay:me:${state.slipId}`);
  if (isMember(perLeague)) return perLeague;
  const global = safeGet('parlay:me');
  return isMember(global) ? global : null;
}

// One slip per league. The first visit creates it; the first visit after the week ends
// rolls it to the new week, clears picks, and refreshes the member list. A new week's
// picks lock 30 minutes before its first kickoff still ahead; the admin can move it.
async function ensureCurrentSlip() {
  const existing = await store.getSlip(state.slipId);
  if (existing && existing.weekEnd > Date.now()) return;

  const [league, users, nfl] = await Promise.all([
    api.fetchLeague(state.slipId),
    api.fetchLeagueUsers(state.slipId),
    api.fetchNflState(),
  ]);
  if (!league) throw new Error('No Sleeper league with that ID.');
  const range = weekWindowAt();
  const week = await sports.weekInRange(Number(nfl.season), Number(nfl.display_week ?? nfl.week), range);
  const cutoff = defaultCutoff(await sports.kickoffs(Number(nfl.season), week, range).catch(() => []));
  const fresh = {
    league: { id: league.league_id, name: league.name, avatar: api.avatarUrl(league.avatar) },
    season: nfl.season,
    week,
    weekStart: range.start,
    weekEnd: range.end,
    members: users.map(api.memberFromUser).sort((a, b) => a.name.localeCompare(b.name)),
    picks: {},
  };

  if (!existing) {
    await store.createSlip(state.slipId, { ...fresh, settings: { locked: false, blockSameGame: false, cutoff } });
    return;
  }
  await store.updateSlip(state.slipId, (slip) => {
    if (slip.weekEnd > Date.now()) return false; // someone else already rolled it
    Object.assign(slip, fresh, { settings: { ...slip.settings, locked: false, cutoff } });
  });
}

// ---------- actions ----------

// Saves a change to your own leg, and shows it right away instead of after the save
// (state.pending): the cell turns yours, the stickers swap, and your face moves in the
// slip's row (faces.js). If the save fails, it all goes back. True if it saved.
async function saveMyLeg(userId, pick, mutate) {
  state.pending = { userId, pick };
  let error = null;
  try {
    render();
    acceptSlip(await store.updateSlip(state.slipId, mutate));
  } catch (e) {
    error = e;
    acceptSlip(await store.getSlip(state.slipId).catch(() => null));
  } finally {
    state.pending = null;
  }
  render();
  if (error) toast(saveError(error), 'bad');
  return !error;
}

async function choose(key) {
  const opt = state.options.get(key);
  // Who's picking is fixed at the tap, so a save that retries can't land on someone else.
  const { me, acting } = state;
  if (!opt || !me || state.pending) return;
  const previous = picks()[me];
  if (previous?.optKey === key) return;
  const game = gameById(opt.gameId);
  if (!game) return;
  const problem = pickProblem(opt);
  if (problem) return toast(problem, 'bad');

  navigator.vibrate?.(12);
  state.justPicked = key;
  setTimeout(() => (state.justPicked = null), 1000); // through the cell's dip as the sticker lands
  const saved = await saveMyLeg(me, pickFrom(opt, game), (slip) => {
    const reason = pickBlockedReason(slip, me, game.start, { admin: !!acting });
    if (reason) throw new Error(reason);
    const clash = clashFor(slip, me, opt);
    if (clash) throw new Error(`${memberName(clash.userId, slip)} just took ${clash.pick.label}. Pick another leg.`);
    slip.picks[me] = pickFrom(opt, game);
  });
  if (saved && matchMedia('(min-width: 960px)').matches) toast(`You’re in: ${pretty(opt.label)}`, 'good');
}

async function removeMine() {
  const { me, acting } = state;
  // The leg on screen. If a new pick saves first, the retry leaves that one alone.
  const optKey = picks()[me]?.optKey;
  if (!optKey || state.pending) return;
  await saveMyLeg(me, null, (slip) => {
    const reason = acting ? null : legLockedReason(slip, me);
    if (reason) throw new Error(reason);
    if (slip.picks[me]?.optKey !== optKey) return false;
    delete slip.picks[me];
  });
}

// Live scores: every minute, while any game this week has kicked off and isn't final,
// refresh just this week's scoreboard.
async function refreshLive() {
  if (!state.slip || document.visibilityState !== 'visible') return;
  if (!state.sports) return loadSports(); // the first load failed; try again
  const now = Date.now();
  if (![...state.sports.games.values()].some((g) => g.start <= now && g.status.state !== 'post')) return;
  try {
    const { season, week } = slipWeek();
    const live = await sports.loadWeek(season, week, { fresh: true });
    let changed = false;
    for (const [key, fresh] of live) {
      const game = state.sports.games.get(key);
      if (game && JSON.stringify(game.status) !== JSON.stringify(fresh.status)) {
        game.status = fresh.status;
        changed = true;
      }
    }
    if (changed) render();
    await loadStartedPrices();
  } catch {
    // Try again next minute.
  }
}

// ---------- alt lines (spread / total strips) ----------

// Scrolling a strip updates just that column's two cells, so the scroll isn't
// interrupted by a full re-render.
function setRung(key, index) {
  const [gameId, type] = key.split(':');
  const game = gameById(gameId);
  if (!game) return;
  const [top, bottom] = ladderSides(game, type, index);
  if (state.rungs.get(key) === top.key) return;
  state.rungs.set(key, top.key);
  for (const [pos, opt] of [['top', top], ['bottom', bottom]]) {
    const el = $app.querySelector(`[data-cell="${CSS.escape(`${key}:${pos}`)}"]`);
    if (el) el.outerHTML = cell(opt, type, el.style.gridArea, `${key}:${pos}`);
  }
  $app.querySelector(`.strip[data-ladder="${CSS.escape(key)}"]`)
    ?.querySelectorAll('.strip-item').forEach((el, i) => el.classList.toggle('on', i === index));
}

// Scrolls each strip to its line. Strips already showing it are left alone, so a redraw
// never interrupts someone mid-swipe.
function syncStrips() {
  for (const strip of $app.querySelectorAll('.strip')) {
    const [gameId, type] = strip.dataset.ladder.split(':');
    const game = gameById(gameId);
    if (!game) continue;
    const left = rungIndex(game, type) * STRIP_ITEM;
    if (Math.abs(strip.scrollLeft - left) >= STRIP_ITEM / 2) strip.scrollLeft = left;
  }
}

$app.addEventListener(
  'scroll',
  (e) => {
    const strip = e.target;
    if (!strip.classList?.contains('strip')) return;
    const key = strip.dataset.ladder;
    const index = Math.min(strip.children.length - 1, Math.max(0, Math.round(strip.scrollLeft / STRIP_ITEM)));
    // syncStrips scrolling a strip to its line fires this too. Only a real swipe pins the
    // column to a line; otherwise it keeps following whoever picks this game.
    const [gameId, type] = key.split(':');
    const game = gameById(gameId);
    if (game && !state.rungs.has(key) && index === rungIndex(game, type)) return;
    setRung(key, index);
  },
  true,
);

// ---------- landing ----------

function landingGo() {
  const match = state.landing.query.match(/\d{6,}/);
  if (!match) {
    state.landing.error = 'Paste a Sleeper league ID (the long number in the league URL).';
    return render();
  }
  location.href = `${basePath}${match[0]}`;
}

// ---------- render ----------

// When each current pick appeared, so stickers slap on for new picks only. A pick
// that goes away is forgotten, so picking a line again slaps its sticker on again.
function trackPicks() {
  const active = new Set(Object.entries(picks()).map(([uid, p]) => `${uid}:${p.optKey}`));
  for (const id of state.pickSince.keys()) if (!active.has(id)) state.pickSince.delete(id);
  for (const id of active) if (!state.pickSince.has(id)) state.pickSince.set(id, state.stickersPrimed ? Date.now() : 0);
}

// A sticker whose pick changed or went away dissolves on its cell: it swells a little,
// blurs, and fades out. Kept as a transient child (dom.js) while it goes.
function dissolveStickers(before) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const [id, { el, cell }] of before) {
    if (state.pickSince.has(id) || el.isConnected || !cell?.isConnected) continue;
    el.classList.remove('slap');
    el.classList.add('leaving');
    el.setAttribute('data-transient', '');
    cell.appendChild(el);
    el.animate(
      [
        { opacity: 1, scale: 1, filter: 'blur(0)' },
        { opacity: 0, scale: 1.3, filter: 'blur(3px)' },
      ],
      { duration: 480, easing: 'ease-out', fill: 'forwards' },
    ).finished.then(() => el.remove());
  }
}

function render() {
  if (holdRender()) return; // the slip is being dragged
  if (state.demoSwitching === 'loading') return; // the demo's next stage is loading
  trackPicks();
  const faces = captureFaces($app);
  const stickers = new Map([...$app.querySelectorAll('.sticker[data-sticker]:not([data-transient])')].map((el) => [el.dataset.sticker, { el, cell: el.parentElement }]));
  patch($app, renderApp());
  animateFaces($app, faces);
  dissolveStickers(stickers);
  syncScrollLock();
  if (state.resetPageScroll) $app.querySelector('.tsheet-body')?.scrollTo(0, 0);
  state.resetPageScroll = false;

  syncStrips();
  syncTearLine();
  syncPageBar();
  fitNames();
  if (state.games.length) state.stickersPrimed = true;
}

// In the live slip, a name that crowds the down and spot (closer than NAME_ROOM px, or
// cut off) shrinks, only that one.
const NAME_ROOM = 14;
function fitNames() {
  for (const el of $app.querySelectorAll('.ll-who')) {
    const spot = el.previousElementSibling; // the spot, on a live leg
    const gap = spot ? el.getBoundingClientRect().left - spot.getBoundingClientRect().right : Infinity;
    if (gap < NAME_ROOM || el.scrollWidth > el.clientWidth + 1) el.classList.add('tight');
  }
}

// The countdown ticks without a re-render: each digit that changed flips down. The flip
// runs as a Web Animation, so a render landing mid-flip can't cut it short.
const TILE_FLIP = [{ transform: 'rotateX(80deg)', filter: 'brightness(1.5)' }, { transform: 'none', filter: 'none' }];
function tickClocks() {
  for (const el of $app.querySelectorAll('.flip-clock')) {
    const ms = Number(el.dataset.until) - Date.now();
    if (ms <= 0) {
      render();
      openIfTracking();
      return;
    }
    el.closest('.lock-bar')?.classList.toggle('soon', ms < 3_600_000);
    const tiles = el.querySelectorAll('i');
    const digits = clockParts(ms).map(([d]) => d).join('');
    if (tiles.length !== digits.length) {
      el.innerHTML = clockTiles(ms);
      continue;
    }
    tiles.forEach((tile, i) => {
      if (tile.textContent === digits[i]) return;
      tile.textContent = digits[i];
      tile.animate(TILE_FLIP, { duration: 450, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' });
    });
  }
}

// ---------- admin ----------

async function adminLogin() {
  const input = document.getElementById('admin-password')?.value ?? '';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hex = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  state.admin.authed = hex === ADMIN_PASSWORD_SHA256;
  state.admin.error = state.admin.authed ? null : 'Wrong password.';
  render();
}

async function adminUpdate(mutate, message) {
  try {
    acceptSlip(await store.updateSlip(state.slipId, mutate));
    toast(message, 'good');
  } catch (e) {
    toast(saveError(e), 'bad');
  }
}

// A new deadline reopens picks and drops picks on games that kick off before it
// (for example, Thursday picks when the deadline moves to Sunday).
async function setCutoff(cutoff) {
  const doomedIn = (all) => Object.entries(all).filter(([, p]) => cutoff && p.start < cutoff);
  const doomed = doomedIn(picks());
  if (doomed.length) {
    const list = doomed.map(([id, p]) => `${memberName(id)}: ${p.label}`).join('\n');
    if (!confirm(`This removes ${doomed.length} ${doomed.length === 1 ? 'pick' : 'picks'} on games before then:\n${list}`)) return;
  }
  // Only the picks the admin was shown get removed; if that list changed, ask again.
  const shown = doomed.map(([id, p]) => `${id}:${p.optKey}`).join();
  await adminUpdate((slip) => {
    if (doomedIn(slip.picks).map(([id, p]) => `${id}:${p.optKey}`).join() !== shown) throw new Error('Picks changed meanwhile. Try again.');
    slip.settings.cutoff = cutoff;
    slip.settings.locked = false;
    for (const [id, p] of Object.entries(slip.picks)) if (cutoff && p.start < cutoff) delete slip.picks[id];
  }, cutoff ? `Picks lock ${dayTimeFmt.format(cutoff)}` : 'Deadline removed');
}

// ---------- research pages ----------

function openPage(entry) {
  state.pages.push(entry);
  state.resetPageScroll = true;
  loadResearch();
  if (entry.kind === 'matchup') loadPastMeetings(entry.gameId);
  render();
}

function popPage() {
  state.pages.pop();
  state.resetPageScroll = true;
  render();
}

async function loadPastMeetings(gameId) {
  const game = gameById(gameId);
  const key = game && gameKey(game.away, game.home);
  if (!game || state.pastMeetings.has(key)) return;
  state.pastMeetings.set(key, 'loading');
  try {
    state.pastMeetings.set(key, await sports.loadPastMeetings(game.away, game.home, slipWeek().season));
  } catch {
    state.pastMeetings.set(key, []);
  }
  render();
}

// Season results + Sleeper stats, loaded once on the first research page opened.
async function loadResearch() {
  const r = state.research;
  if (r.league || r.loading) return;
  r.loading = true;
  r.error = null;
  try {
    // The board already built the league from this season's results; add the stats.
    const { season, week } = slipWeek();
    const [league, stats] = await Promise.all([
      state.sports?.league ?? sports.loadSeasonResults(season, week).then(buildLeague),
      api.fetchSeasonStats(state.slip.season, week),
    ]);
    r.league = addStats(league, stats);
  } catch (e) {
    r.error = e.message;
  }
  r.loading = false;
  render();
}

// A player headshot that fails to load hides, and stays hidden through redraws.
$app.addEventListener('error', (e) => {
  if (e.target.tagName !== 'IMG' || !e.target.closest('.pl-head')) return;
  state.failedImages.add(e.target.getAttribute('src'));
  e.target.style.visibility = 'hidden';
}, true);

// The page's top bar turns solid once you scroll past the hero. At the very top, the
// sheet shows the band that continues the hero's glow when you pull down past it.
function syncPageBar() {
  const body = $app.querySelector('.tsheet-body');
  if (!body) return;
  const top = body.scrollTop;
  $app.querySelector('.ts-bar')?.classList.toggle('solid', top > 70);
  const sheet = body.parentElement;
  sheet.classList.toggle('at-top', top <= 0);
}

$app.addEventListener('scroll', (e) => e.target.classList?.contains('tsheet-body') && syncPageBar(), true);

// ---------- slip ----------

// Once per browser, after the lines load, bounce the closed slip so people notice it
// pulls up.
function nudgeSlip() {
  if (!state.slipNudge) return;
  state.slipNudge = false;
  safeSet('parlay:nudged', '1');
  if (state.sheetOpen) return;
  state.nudging = true;
  render();
  setTimeout(() => {
    state.nudging = false;
    render();
  }, 1600);
}

// ---------- events ----------

// Where the current press started. A click only counts on the control it was pressed
// on: tapping or dragging the slip open can make iOS deliver the touch's click to
// whatever slid under the finger meanwhile, like the Remove button on your leg.
let pressedOn = null;
$app.addEventListener('pointerdown', (e) => (pressedOn = e.target), true);

$app.addEventListener('click', (e) => {
  const pressed = pressedOn;
  pressedOn = null; // one press, one click
  // Tapping a line on a strip slides to it, the same as swiping there.
  const item = e.target.closest('.strip-item');
  if (item) return item.parentElement.scrollTo({ left: [...item.parentElement.children].indexOf(item) * STRIP_ITEM, behavior: 'smooth' });
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  // e.detail is 0 for keyboard and other non-pointer clicks; those have no press.
  if (e.detail !== 0 && pressed && !el.contains(pressed)) return;
  const { action, id, key } = el.dataset;

  switch (action) {
    case 'choose': return choose(key);
    case 'team': return openPage({ kind: 'team', abbr: id });
    case 'matchup': return openPage({ kind: 'matchup', gameId: id });
    case 'page-back': return popPage();
    case 'close-page':
      state.pages = [];
      return render();
    // Tapping the solid top bar's title scrolls the page back to the top.
    case 'page-top':
      return $app.querySelector('.tsheet-body')?.scrollTo({ top: 0, behavior: 'smooth' });
    case 'be':
      state.me = id;
      state.switchingUser = false;
      safeSet(`parlay:me:${state.slipId}`, id);
      safeSet('parlay:me', id);
      window.scrollTo(0, 0);
      render();
      return openIfTracking();
    case 'switch-user':
      state.switchingUser = true;
      window.scrollTo(0, 0);
      return render();
    case 'cancel-switch':
      state.switchingUser = false;
      return render();
    case 'odds':
      state.oddsFormat = id;
      safeSet('parlay:odds', id);
      return render();
    case 'jump':
      return document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    case 'close-sheet': return setSlipOpen(false);
    case 'remove-mine': return removeMine();
    case 'admin-cutoff': return setCutoff(id === 'none' ? null : Number(id));
    case 'admin-lock': return adminUpdate((slip) => (slip.settings.locked = true), 'Picks locked');
    case 'admin-unlock':
      // Unlocking after the deadline passed clears it; pick a new one to lock again.
      return adminUpdate((slip) => {
        slip.settings.locked = false;
        if (slipLocked(slip)) slip.settings.cutoff = null;
      }, 'Picks unlocked');
    case 'admin-remove': {
      const pick = picks()[id];
      if (!pick || !confirm(`Remove ${memberName(id)}’s pick (${pick.label})?`)) return;
      return adminUpdate((slip) => {
        if (slip.picks[id]?.optKey !== pick.optKey) throw new Error(`${memberName(id)} changed their pick meanwhile, so nothing was removed.`);
        delete slip.picks[id];
      }, 'Pick removed');
    }
    case 'admin-act':
      state.acting = { id, prevMe: state.me };
      state.me = id;
      window.scrollTo(0, 0);
      return render();
    case 'acting-done':
      state.me = state.acting.prevMe;
      state.acting = null;
      setSlipOpen(false);
      window.scrollTo(0, 0);
      return render();
    case 'reload-lines':
      state.lobby = null;
      return loadLines();
    case 'reload-page':
      return location.reload();
  }
});

$app.addEventListener('input', (e) => {
  if (e.target.id === 'league-query') state.landing.query = e.target.value;
});

// The demo's stage picker (top bar).
$app.addEventListener('change', (e) => {
  if (e.target.id === 'demo-mode') switchDemoStage(e.target.value);
});

$app.addEventListener('submit', (e) => {
  if (e.target.dataset.form === 'league') {
    e.preventDefault();
    landingGo();
  } else if (e.target.dataset.form === 'admin-login') {
    e.preventDefault();
    adminLogin();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.pages.length) popPage();
  else if (e.key === 'Escape' && state.sheetOpen) setSlipOpen(false);
});

// ---------- boot ----------

initSheet($app, render);
if (state.slipId) startSlip();
render();
