import * as api from './api.js';
import * as store from './store.js';
import * as sports from './sports.js';
import { matchupColors, TEAM_COLORS } from './teams.js';
import { buildLeague, commonOpponents, headToHead, recordOf, resume, winChains } from './research.js';
import { americanOdds, buildGames, indexOptions, multiplierToAmerican, weekWindowAt } from './lines.js';

const $app = document.getElementById('app');

// Routes: "<base>/" is the landing page, "<base>/<leagueId>" is that league's slip.
// <base> is "/" locally and "/<repo>/" on GitHub Pages.
const pathParts = location.pathname.replace(/\/index\.html$/, '').split('/').filter(Boolean);
const routeLeagueId = /^\d{6,}$/.test(pathParts.at(-1) ?? '') ? pathParts.pop() : null;
const basePath = `/${pathParts.join('/')}${pathParts.length ? '/' : ''}`;

const state = {
  slipId: routeLeagueId,
  slip: undefined, // undefined = loading, null = failed to load
  loadError: null,
  lobby: null,
  details: new Map(),
  games: [],
  options: new Map(),
  gamesError: null,
  me: null,
  switchingUser: false,
  rungs: new Map(), // "<gameId>:<spread|total>" -> selected line index
  sports: null, // { games, teams }: this week's games (sports.loadWeek) and team summaries
  pages: [], // research pages, a stack: { kind: 'team', abbr } or { kind: 'matchup', gameId }
  research: { league: null, loading: false, error: null }, // see research.js
  pastMeetings: new Map(), // "<away>@<home>" -> meetings from the last two seasons, or 'loading'
  resetPageScroll: false,
  seenStickers: new Set(), // stickers already shown, so only new ones get slapped on
  stickersPrimed: false, // false until the first board render; stickers there don't animate
  showStarted: false,
  busyKey: null,
  facesHold: null, // faces order kept while your avatar flies into the slip
  oddsFormat: safeGet('parlay:odds') === 'pct' ? 'pct' : 'american',
  sheetOpen: false,
  // Nudge the closed slip once per visit so people notice it pulls up.
  slipNudge: safeGet('parlay:nudged') !== '1',
  landing: { query: '', error: null },
  toast: null,
};

class UserError extends Error {}

// ---------- helpers ----------

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* private mode */ }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
const shortDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

const memberById = (id) => state.slip?.members.find((m) => m.id === id);
const picks = () => state.slip?.picks ?? {};

const fmtOdds = (price) => (state.oddsFormat === 'pct' ? (price > 0 && price < 100 ? `${price}%` : '—') : americanOdds(price));

// Fair (no-vig) parlay: multiply each leg's fair probability. A reference for what
// the slip should pay, since the real price is set wherever the parlay gets placed.
function fairParlay(legs) {
  const prob = legs.reduce((acc, l) => acc * l.fair, 1);
  const mult = 1 / prob;
  const odds = state.oddsFormat === 'pct'
    ? `${(prob * 100).toFixed(prob >= 0.1 ? 0 : prob >= 0.01 ? 1 : 2)}%`
    : multiplierToAmerican(mult).replace(/\d+/, (n) => Number(n).toLocaleString());
  return { odds, mult: mult >= 100 ? Math.round(mult).toLocaleString() : mult.toFixed(1) };
}

// Typographic minus for line labels like "JAX -7.5".
const pretty = (label) => String(label ?? '').replace(/ -(?=\d)/, ' −');

function avatar(member, size = 32, extraClass = '') {
  const style = `width:${size}px;height:${size}px`;
  if (member?.avatar) return `<img class="avatar ${extraClass}" style="${style}" src="${esc(member.avatar)}" alt="" loading="lazy">`;
  const initials = (member?.name ?? '?').slice(0, 2).toUpperCase();
  return `<span class="avatar avatar-fallback ${extraClass}" style="${style};font-size:${Math.round(size * 0.38)}px">${esc(initials)}</span>`;
}

function teamLogo(abbr, size = 32) {
  return `<img class="logo" style="width:${size}px;height:${size}px" src="${esc(api.teamLogo(abbr))}" alt="${esc(abbr)}" loading="lazy">`;
}

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

// Who already holds a conflicting leg: one leg per game + bet type (or one per game
// when the slip's blockSameGame setting is on).
function clashFor(slip, userId, opt) {
  for (const [uid, pick] of Object.entries(slip.picks ?? {})) {
    if (uid === userId || pick.gameId !== opt.gameId) continue;
    if (slip.settings?.blockSameGame || pick.type === opt.type) return { userId: uid, pick };
  }
  return null;
}

// ---------- data loading ----------

async function loadLines() {
  if (!state.slip) return;
  try {
    state.lobby ??= await api.fetchLobby();
    const window = { start: state.slip.weekStart, end: state.slip.weekEnd };
    let games = buildGames(state.lobby, state.details, window);
    const events = await api.fetchEvents(games.flatMap((g) => [g.id, ...g.relatedIds]));
    state.details = new Map(events.map((e) => [e.event_id, e]));
    games = buildGames(state.lobby, state.details, window);
    state.games = games;
    state.options = indexOptions(games);
    state.gamesError = null;
    if (state.slipNudge) setTimeout(nudgeSlip, 300);
    if (new URLSearchParams(location.search).has('demo')) await seedDemoPicks();
  } catch (e) {
    state.gamesError = e.message;
  }
  render();
}

// "?demo" gives about half your league mates a random leg, following the same
// conflict rules. Handy while slips live in localStorage.
async function seedDemoPicks() {
  history.replaceState(null, '', location.pathname); // so a reload doesn't seed again
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
  let added = 0;
  state.slip = await store.updateSlip(state.slipId, (slip) => {
    // Half of your league mates (not counting you) end up with a pick.
    const mates = slip.members.filter((m) => m.id !== state.me);
    const target = Math.floor(mates.length / 2) - mates.filter((m) => slip.picks[m.id]).length;
    const pickers = shuffle(mates.filter((m) => !slip.picks[m.id])).slice(0, Math.max(0, target));
    for (const member of pickers) {
      const opt = shuffle(open).find((o) => !clashFor(slip, member.id, o));
      if (!opt) break;
      const game = state.games.find((g) => g.id === opt.gameId);
      slip.picks[member.id] = {
        optKey: opt.key, gameId: opt.gameId, type: opt.type, label: opt.label, matchup: game.matchup,
        price: opt.price, fair: opt.fair, start: game.start, pickedAt: Date.now(),
      };
      added++;
    }
  });
  toast(`Demo: added ${added} league-mate picks`, 'good');
}

async function startSlip() {
  try {
    await ensureCurrentSlip();
  } catch (e) {
    state.slip = null;
    state.loadError = e.message;
    return render();
  }
  store.watchSlip(state.slipId, (slip) => {
    const firstLoad = state.slip === undefined;
    const weekChanged = state.slip && slip && state.slip.weekStart !== slip.weekStart;
    const legsBefore = Object.keys(state.slip?.picks ?? {}).length;
    state.slip = slip;
    if (!firstLoad && Object.keys(slip?.picks ?? {}).length > legsBefore) setTimeout(bumpFaces, 50);
    if (firstLoad) state.me = rememberedMe(slip);

    if (firstLoad || weekChanged) {
      state.lobby = weekChanged ? null : state.lobby;
      loadLines();
      loadSports();
    }
    render();
  });
  setInterval(refreshLive, 60_000);
  // Prices move; refresh the full events every 45s and the lobby every 5 min.
  setInterval(() => document.visibilityState === 'visible' && loadLines(), 45_000);
  setInterval(() => (state.lobby = null), 5 * 60_000);
}

// This week's games (TV, weather, live scores) and every team's record, streak, and
// last five, from Sleeper's scores endpoints.
async function loadSports() {
  try {
    const season = Number(state.slip.season);
    const week = Number(state.slip.week);
    const [games, results] = await Promise.all([sports.loadWeek(season, week), sports.loadSeasonResults(season, week)]);
    state.sports = { games, teams: sports.summarizeTeams(results) };
    render();
    // Once the parlay is underway, open straight into the slip to follow along.
    if (!state.trackOpened && isTracking(legsWithLive())) {
      state.trackOpened = true;
      setSlip(true);
    }
  } catch {
    // Records and weather are extras; the slip works without them.
  }
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
// rolls it to the new week, clears picks, and refreshes the member list.
async function ensureCurrentSlip() {
  const existing = await store.getSlip(state.slipId);
  if (existing && existing.weekEnd > Date.now()) return;

  const [league, users, nfl] = await Promise.all([
    api.fetchLeague(state.slipId),
    api.fetchLeagueUsers(state.slipId),
    api.fetchNflState(),
  ]);
  if (!league) throw new Error('No Sleeper league with that ID.');
  const window = weekWindowAt();
  const fresh = {
    league: { id: league.league_id, name: league.name, avatar: api.avatarUrl(league.avatar) },
    season: nfl.season,
    week: nfl.display_week ?? nfl.week,
    weekStart: window.start,
    weekEnd: window.end,
    members: users.map(api.memberFromUser).sort((a, b) => a.name.localeCompare(b.name)),
    picks: {},
  };

  if (!existing) {
    await store.createSlip(state.slipId, { ...fresh, settings: { locked: false, blockSameGame: false } });
    return;
  }
  await store.updateSlip(state.slipId, (slip) => {
    if (slip.weekEnd > Date.now()) return; // someone else already rolled it
    Object.assign(slip, fresh, { settings: { ...slip.settings, locked: false } });
  });
}

// ---------- actions ----------

async function choose(key) {
  const opt = state.options.get(key);
  if (!opt || !state.me || state.busyKey) return;
  const previous = picks()[state.me];
  if (previous?.optKey === key) return;
  const game = state.games.find((g) => g.id === opt.gameId);
  const known = clashFor(state.slip, state.me, opt);
  if (known) return toast(`${memberById(known.userId)?.name ?? 'Someone'} already has ${known.pick.label}.`, 'bad');
  if (state.slip.settings.locked) return toast('Picks are locked for this week.', 'bad');
  if (game?.locked || !opt.available) return toast('That line is closed.', 'bad');

  const from = $app.querySelector(`.cell[data-key="${key}"]`)?.getBoundingClientRect();
  const facesBefore = legsWithLive().map((l) => l.member.id);
  let picked = false;
  state.busyKey = key;
  render();
  try {
    state.slip = await store.updateSlip(state.slipId, (slip) => {
      if (slip.settings.locked) throw new UserError('Picks are locked for this week.');
      const clash = clashFor(slip, state.me, opt);
      if (clash) {
        const who = slip.members.find((m) => m.id === clash.userId)?.name ?? 'Someone';
        throw new UserError(`${who} just took ${clash.pick.label}. Pick another leg.`);
      }
      slip.picks[state.me] = {
        optKey: key,
        gameId: opt.gameId,
        type: opt.type,
        label: opt.label,
        matchup: game.matchup,
        price: opt.price,
        fair: opt.fair,
        start: game.start,
        pickedAt: Date.now(),
      };
    });
    navigator.vibrate?.(12);
    state.justPicked = key;
    setTimeout(() => (state.justPicked = null), 600);
    picked = true;
    if (matchMedia('(min-width: 960px)').matches) toast(`You’re in: ${pretty(opt.label)}`, 'good');
  } catch (e) {
    state.slip = (await store.getSlip(state.slipId)) ?? state.slip;
    toast(e.message, 'bad');
  } finally {
    state.busyKey = null;
    // Keep the faces row in its old order until the avatar lands in it.
    if (picked && from) state.facesHold = facesBefore;
    render();
    if (state.facesHold && !flyToSlip(from)) releaseFaces();
  }
}

// The faces row of whichever slip is showing: the phone slip and the desktop ticket
// are both in the page, and the hidden one measures as 0x0 at the top left.
const visibleFaces = () => [...$app.querySelectorAll('.slip-peek .faces')].find((f) => f.offsetWidth);

// Your avatar hops from the cell you tapped into the slip at the bottom.
function flyToSlip(from) {
  const me = memberById(state.me);
  const target = visibleFaces();
  if (!me || !target || matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const to = target.getBoundingClientRect();
  const size = 30;
  const el = document.createElement('div');
  el.className = 'flyer';
  el.innerHTML = avatar(me, size);
  const x0 = from.left + from.width / 2 - size / 2;
  const y0 = from.top + from.height / 2 - size / 2;
  const x1 = to.right - size + 4;
  const y1 = to.top + to.height / 2 - size / 2;
  Object.assign(el.style, { left: `${x0}px`, top: `${y0}px` });
  document.body.appendChild(el);
  const lift = Math.min(120, Math.abs(y1 - y0) * 0.35);
  el.animate(
    [
      { transform: 'translate(0, 0) scale(1.15)', opacity: 1 },
      { transform: `translate(${(x1 - x0) / 2}px, ${(y1 - y0) / 2 - lift}px) scale(1.05)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x1 - x0}px, ${y1 - y0}px) scale(0.75)`, opacity: 0.9 },
    ],
    { duration: 650, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  ).finished.then(() => {
    el.remove();
    releaseFaces();
    bumpFaces();
  });
  return true;
}

function releaseFaces() {
  state.facesHold = null;
  render();
}

function bumpFaces() {
  const faces = visibleFaces();
  if (!faces) return;
  faces.classList.remove('bump');
  void faces.offsetWidth; // restart the animation
  faces.classList.add('bump');
}

async function removeMine() {
  try {
    state.slip = await store.updateSlip(state.slipId, (slip) => delete slip.picks[state.me]);
    toast('Removed your pick');
  } catch (e) {
    toast(e.message, 'bad');
  }
  render();
}

function legsWithLive() {
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
      const status = state.sports?.games.get(pick.matchup.replace(' @ ', '@'))?.status;
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
    .sort((a, b) => a.pick.start - b.pick.start);
}

// Grade a pick against a score: 'hit', 'miss', or 'push'. Used for finals, and for
// "covering right now" while a game is live.
function gradePick(pick, awayScore, homeScore) {
  const [away] = pick.matchup.split(' @ ');
  const [first, rest] = pick.label.split(' ');
  let margin;
  if (pick.type === 'total') {
    const line = Number(rest);
    margin = first === 'Over' ? awayScore + homeScore - line : line - (awayScore + homeScore);
  } else {
    const mine = first === away ? awayScore : homeScore;
    const theirs = first === away ? homeScore : awayScore;
    const line = pick.type === 'spread' ? Number(String(rest).replace('−', '-')) : 0;
    margin = mine + line - theirs;
  }
  return margin > 0 ? 'hit' : margin < 0 ? 'miss' : 'push';
}

// Live scores: every minute, while any game this week has kicked off and isn't final,
// refresh just this week's scoreboard.
async function refreshLive() {
  if (!state.sports || !state.slip || document.visibilityState !== 'visible') return;
  const now = Date.now();
  const pending = state.games.some((g) => g.start <= now && state.sports.games.get(`${g.away}@${g.home}`)?.status?.state !== 'post');
  if (!pending) return;
  try {
    const live = await sports.loadWeek(Number(state.slip.season), Number(state.slip.week), { fresh: true });
    for (const [key, fresh] of live) {
      const game = state.sports.games.get(key);
      if (game) game.status = fresh.status;
    }
    render();
  } catch {
    // Try again next minute.
  }
}

// ---------- alt lines (spread / total strips) ----------

const ladderKey = (game, type) => `${game.id}:${type}`;
const rungHas = (rung, key) => [rung.away, rung.home, rung.over, rung.under].some((o) => o?.key === key);

// Which line a spread/total column shows: what the user stepped to, else whoever
// already picked this game + type (so the pick is visible), else the main line.
function rungIndex(game, type) {
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

const STRIP_ITEM = 36; // px, must match .strip-item width in CSS

// Scrolling a strip updates just that column's two cells, so the scroll isn't
// interrupted by a full re-render.
function setRung(key, index) {
  if (state.rungs.get(key) === index) return;
  state.rungs.set(key, index);
  const [gameId, type] = key.split(':');
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return;
  const [top, bottom] = ladderSides(game, type, index);
  for (const [pos, opt] of [['top', top], ['bottom', bottom]]) {
    const el = $app.querySelector(`[data-cell="${key}:${pos}"]`);
    if (el) el.outerHTML = cell(opt, type, el.style.gridArea, `${key}:${pos}`);
  }
  $app.querySelector(`.strip[data-ladder="${key}"]`)
    ?.querySelectorAll('.strip-item').forEach((el, i) => el.classList.toggle('on', i === index));
}

function syncStrips() {
  for (const strip of $app.querySelectorAll('.strip')) {
    const [gameId, type] = strip.dataset.ladder.split(':');
    const game = state.games.find((g) => g.id === gameId);
    if (game) strip.scrollLeft = rungIndex(game, type) * STRIP_ITEM;
  }
}

$app.addEventListener(
  'scroll',
  (e) => {
    const strip = e.target;
    if (!strip.classList?.contains('strip')) return;
    const count = strip.children.length;
    setRung(strip.dataset.ladder, Math.min(count - 1, Math.max(0, Math.round(strip.scrollLeft / STRIP_ITEM))));
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

function render() {
  // A background refresh mid-drag would replace the slip under the finger; wait.
  if (slipDrag) {
    slipDrag.pendingRender = true;
    return;
  }
  const active = document.activeElement;
  const focusId = active?.id;
  const selection = focusId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const sheetScroll = $app.querySelector('.sheet-body')?.scrollTop;
  const teamScroll = state.resetPageScroll ? 0 : $app.querySelector('.tsheet-body')?.scrollTop;
  state.resetPageScroll = false;

  $app.innerHTML = (state.slipId ? renderSlipPage() : renderLanding()) + renderToast();
  document.body.classList.toggle('no-scroll', state.sheetOpen || state.pages.length > 0);

  syncStrips();
  syncTearLine();
  if (state.games.length) state.stickersPrimed = true;
  if (sheetScroll) $app.querySelector('.sheet-body')?.scrollTo(0, sheetScroll);
  if (teamScroll) $app.querySelector('.tsheet-body')?.scrollTo(0, teamScroll);
  syncPageBar();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (selection) try { el.setSelectionRange(...selection); } catch { /* number inputs */ }
    }
  }
}

function renderToast() {
  if (!state.toast) return '';
  return `<div class="toast toast-${state.toast.tone}" role="status">${esc(state.toast.message)}</div>`;
}

function renderLanding() {
  const l = state.landing;
  return `
  <main class="landing">
    <section class="hero">
      <div class="brand-mark">🏈</div>
      <h1>Parlay Pool</h1>
      <p class="lede">Everyone in your Sleeper league adds one leg. One slip, live NFL lines.</p>
    </section>
    <form data-form="league" class="card league-form">
      <label for="league-query" class="field-label">Sleeper league ID</label>
      <div class="search-row">
        <input id="league-query" class="input" placeholder="e.g. 1365380346513723392" value="${esc(l.query)}" autocomplete="off" inputmode="numeric">
        <button class="btn btn-primary">Open</button>
      </div>
      ${l.error ? `<p class="error">${esc(l.error)}</p>` : '<p class="hint">It’s the long number in your league’s Sleeper URL.</p>'}
    </form>
  </main>`;
}

function renderSlipPage() {
  if (state.slip === undefined) return `<main class="center"><div class="spinner"></div></main>`;
  if (state.slip === null) {
    return `<main class="center"><div class="card narrow"><h2>Couldn’t open this league</h2><p class="muted">${esc(state.loadError ?? 'Something went wrong.')}</p><a class="btn btn-primary" href="${basePath}">Try another league</a></div></main>`;
  }
  const me = memberById(state.me);
  if (!me || state.switchingUser) return renderTopbar(null) + renderWhoAreYou(me);

  return `
    ${renderTopbar(me)}
    ${renderSubbar()}
    <div class="layout">
      <main class="games">${renderGames()}</main>
      <aside class="parlay-side">${renderParlayCard()}</aside>
    </div>
    ${renderSlip()}
    ${state.pages.length ? renderPage() : ''}`;
}

function renderTopbar(me) {
  const slip = state.slip;
  const legCount = Object.keys(picks()).length;
  return `
  <header class="topbar">
    <div class="topbar-league">
      ${avatar(slip.league, 34, 'league-avatar')}
      <div class="topbar-text">
        <strong>${esc(slip.league.name)}</strong>
        <small>Week ${esc(slip.week)} · ${legCount} ${legCount === 1 ? 'leg' : 'legs'}${slip.settings.locked ? ' · 🔒 Locked' : ''}</small>
      </div>
    </div>
    ${me ? `
      <button class="me-chip" data-action="switch-user" aria-label="Signed in as ${esc(me.name)}. Not you?">
        <span class="me-text"><strong>${esc(me.name)}</strong><small>not you?</small></span>
        ${avatar(me, 34)}
      </button>` : ''}
  </header>`;
}

function renderSubbar() {
  const upcoming = state.games.filter((g) => !g.locked);
  const days = [...new Map(upcoming.map((g) => [dayFmt.format(g.start), g.start])).entries()];
  return `
  <nav class="subbar">
    <div class="day-chips">
      ${days.map(([, start], i) => `<button class="day-chip" data-action="jump" data-id="day-${i}">${esc(shortDayFmt.format(start))}</button>`).join('')}
    </div>
    <div class="seg" role="group" aria-label="Odds format">
      <button class="${state.oddsFormat === 'american' ? 'on' : ''}" data-action="odds" data-id="american">+110</button>
      <button class="${state.oddsFormat === 'pct' ? 'on' : ''}" data-action="odds" data-id="pct">%</button>
    </div>
  </nav>`;
}

function renderWhoAreYou(current) {
  return `
  <main class="who">
    <div class="who-head">
      <h1>Who’s picking?</h1>
    </div>
    <div class="who-list">
      ${state.slip.members.map((m) => {
        const pick = picks()[m.id];
        return `
        <button class="who-row ${m.id === current?.id ? 'current' : ''}" data-action="be" data-id="${esc(m.id)}">
          ${avatar(m, 32)}
          <span class="who-name"><strong>${esc(m.name)}</strong>${m.teamName ? `<small>${esc(m.teamName)}</small>` : ''}</span>
          ${pick ? `<span class="pill pill-good">${esc(pretty(pick.label))}</span>` : '<span class="chev">›</span>'}
        </button>`;
      }).join('')}
    </div>
    ${current ? `<button class="btn btn-ghost btn-block" data-action="cancel-switch">Keep me as ${esc(current.name)}</button>` : ''}
  </main>`;
}

function renderGames() {
  if (state.gamesError) return `<div class="card"><p class="error">Couldn’t load lines: ${esc(state.gamesError)}</p><button class="btn" data-action="reload-lines">Retry</button></div>`;
  if (!state.games.length && !state.lobby) return `<div class="loading-block"><div class="spinner"></div><p class="muted">Loading this week’s lines…</p></div>`;
  if (!state.games.length) return `<div class="card"><p>No NFL games found for this week yet.</p></div>`;

  const upcoming = state.games.filter((g) => !g.locked);
  const started = state.games.filter((g) => g.locked);
  const byDay = new Map();
  for (const g of upcoming) {
    const day = dayFmt.format(g.start);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(g);
  }
  const sections = [...byDay].map(([day, games], i) => `
    <section class="day" id="day-${i}">
      <h2 class="day-title">${esc(day)}</h2>
      ${games.map(renderGame).join('')}
    </section>`).join('');

  const startedSection = started.length ? `
    <section class="day started">
      <button class="day-title started-toggle" data-action="toggle-started">
        Started · ${started.length} ${started.length === 1 ? 'game' : 'games'} <span>${state.showStarted ? '▴' : '▾'}</span>
      </button>
      ${state.showStarted ? started.map(renderGame).join('') : ''}
    </section>` : '';
  return sections + startedSection;
}

function gameTakers(game) {
  return Object.entries(picks())
    .filter(([, p]) => p.gameId === game.id)
    .map(([uid, p]) => ({ member: memberById(uid), pick: p, mine: uid === state.me }));
}

const fmtLine = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

// Leading +/− drawn lighter and slimmer than the digits, so numbers scan by size.
const signed = (text) => String(text).replace(/^([+−-])/, '<span class="sign">$1</span>');

// Spread: away team on top. Total: over on top (sportsbook convention).
function ladderSides(game, type, index) {
  const rung = game[type].rungs[index];
  return type === 'spread' ? [rung.away, rung.home] : [rung.over, rung.under];
}

function weatherIcon(text = '') {
  const t = text.toLowerCase();
  if (t.includes('thunder')) return '⛈️';
  if (t.includes('snow') || t.includes('flurr')) return '🌨️';
  if (t.includes('rain') || t.includes('shower') || t.includes('drizzle')) return '🌧️';
  if (t.includes('fog') || t.includes('haze')) return '🌫️';
  if (t.includes('wind')) return '💨';
  if (['partly', 'mostly sunny', 'intermittent', 'scattered', 'few', 'broken'].some((w) => t.includes(w))) return '⛅';
  if (t.includes('cloud') || t.includes('overcast')) return '☁️';
  return '☀️';
}

// TV networks (Sleeper's channel codes: CBS, FOX, NBC/Peacock, ESPN, ABC, AMZN, NFLN).
// Real logos where a free source has them: NBC's color peacock from
// Wikimedia Commons; CBS, FOX (in gold), Netflix, YouTube from Simple Icons. ESPN,
// ABC, and Prime Video get badges in their brand colors. Unknown networks are text.
const WIKI = 'https://upload.wikimedia.org/wikipedia/commons';
const NETWORKS = [
  [/^cbs/, 'CBS', { src: 'https://cdn.simpleicons.org/cbs/ffffff', label: 'CBS' }],
  // The NBC file has black "NBC" letters under the peacock; show only the peacock.
  [/^nbc/, 'NBC', { src: `${WIKI}/3/3f/NBC_logo.svg`, label: 'NBC', crop: 'nbc' }],
  [/^fox/, 'FOX', { src: 'https://cdn.simpleicons.org/fox/f5c542', crop: 'fox' }],
  [/netflix/, 'Netflix', { src: 'https://cdn.simpleicons.org/netflix' }],
  [/youtube/, 'YouTube', { src: 'https://cdn.simpleicons.org/youtube', label: 'YouTube' }],
  [/^espn/, 'ESPN', { badge: 'espn' }],
  [/^abc/, 'abc', { badge: 'abc' }],
  [/prime|amzn|amazon/, 'prime video', { badge: 'prime' }],
  [/^nfl ?n/, 'NFL Network', { badge: 'nfln' }],
  [/peacock/, 'Peacock', { badge: 'peacock' }],
];

function tvBadges(tv) {
  const names = tv.split(/[/,]/).map((name) => name.trim()).filter(Boolean);
  // NBC games also stream on Peacock; the NBC badge alone says enough.
  const hasNbc = names.some((name) => /^nbc$/i.test(name));
  return names.filter((name) => !(hasNbc && /peacock/i.test(name))).map((name) => {
    const match = NETWORKS.find(([re]) => re.test(name.toLowerCase()));
    if (!match) return `<span class="tv">${esc(name)}</span>`;
    const [, title, how] = match;
    if (how.src) {
      return `<span class="tv-logo ${how.crop ? `tv-crop-${how.crop}` : ''}" title="${esc(title)}"><span class="tv-img"><img src="${how.src}" alt="${esc(title)}"></span>${how.label ? esc(how.label) : ''}</span>`;
    }
    return `<span class="tv tv-${how.badge}">${esc(title)}</span>`;
  }).join('');
}

// Kickoff time (the day is already in the section header), then TV and weather.
function gameMeta(game, { research = true } = {}) {
  const info = state.sports?.games.get(`${game.away}@${game.home}`);
  const items = [`<span class="meta-time">${esc(timeFmt.format(game.start))}</span>`];
  if (info?.tv) items.push(`<span class="tv-list">${tvBadges(info.tv)}</span>`);
  if (info?.dome) items.push('<span>🏟️ Dome</span>');
  else if (info?.weather) items.push(`<span title="${esc(info.weather.text)}">${weatherIcon(info.weather.text)} ${esc(info.weather.temp)}°</span>`);
  if (research) items.push(`<button class="meta-research" data-action="matchup" data-id="${esc(game.id)}">Matchup ${chevronSmall()}</button>`);
  return items.join('');
}

function formDots(team) {
  if (!team?.lastFive.length) return '';
  // Oldest on the left, most recent on the right.
  return `<span class="dots">${[...team.lastFive].reverse().map((g) => `<i class="${g.won ? 'w' : g.tie ? 't' : 'l'}"></i>`).join('')}</span>`;
}

// Sportsbook grid: two team rows x (Money | Spread | Total), with a line strip
// between the team rows. Taken picks show the picker's avatar in place; once someone
// holds a game + bet type, the rest of that column is disabled.
function renderGame(game) {
  const takers = gameTakers(game);
  if (game.locked) {
    const st = state.sports?.games.get(`${game.away}@${game.home}`)?.status;
    const scored = st && st.state !== 'pre';
    return `
    <article class="game locked ${st?.state === 'in' ? 'is-live' : ''}">
      <div class="locked-line">
        ${teamLogo(game.away, 20)} <b>${esc(game.away)}</b>${scored ? `<span class="ls">${st.awayScore}</span>` : ''}
        <span class="muted">–</span>
        ${scored ? `<span class="ls">${st.homeScore}</span>` : ''}<b>${esc(game.home)}</b> ${teamLogo(game.home, 20)}
        <span class="kick ${st?.state === 'in' ? 'live' : 'is-locked'}">${st?.state === 'in' ? `● ${esc(st.detail)}` : st?.state === 'post' ? 'Final' : 'Started'}</span>
      </div>
      ${takers.length ? `<div class="locked-picks">${takers.map((t) => `<span class="pill">${avatar(t.member, 18)} ${esc(pretty(t.pick.label))}</span>`).join('')}</div>` : ''}
    </article>`;
  }

  const teamCell = (abbr, row) => {
    const team = state.sports?.teams.get(abbr);
    return `
      <button class="g-team" style="grid-area:${row}/2" data-action="team" data-id="${esc(abbr)}">
        ${teamLogo(abbr, 24)}
        <strong class="g-abbr">${esc(abbr)}</strong>
        <small class="g-record">${esc(team?.record ?? '')}</small>
        ${formDots(team)}
      </button>`;
  };

  const columns = [
    { type: 'ml', label: 'Money', has: game.ml.some(Boolean) },
    { type: 'spread', label: 'Spread', has: !!game.spread?.rungs.length },
    { type: 'total', label: 'Total', has: !!game.total?.rungs.length },
  ].map((c, i) => ({ ...c, col: i + 3 }));

  // Column 1 is the win-chance bar, column 2 the teams, then Money, Spread, Total.
  let html = columns.map((c) => `<div class="g-head" style="grid-area:1/${c.col}">${c.label}</div>`).join('');
  // Rows: 2 = away team, 3 = line strips, 4 = home team.
  html += winBar(game) + teamCell(game.away, 2) + teamCell(game.home, 4);
  for (const c of columns) {
    if (!c.has) {
      html += `<span class="cell cell-empty" style="grid-area:2/${c.col}">—</span><span class="cell cell-empty" style="grid-area:4/${c.col}">—</span>`;
      continue;
    }
    if (c.type === 'ml') {
      html += cell(game.ml[0], 'ml', `2/${c.col}`) + cell(game.ml[1], 'ml', `4/${c.col}`);
      continue;
    }
    const key = ladderKey(game, c.type);
    const index = rungIndex(game, c.type);
    const [top, bottom] = ladderSides(game, c.type, index);
    html += cell(top, c.type, `2/${c.col}`, `${key}:top`) + cell(bottom, c.type, `4/${c.col}`, `${key}:bottom`);
    html += strip(game, c.type, key, index, `3/${c.col}`);
  }

  return `
  <article class="game ${takers.some((t) => t.mine) ? 'has-mine' : ''}">
    <div class="g-meta">${gameMeta(game)}</div>
    <div class="g-grid">${html}</div>
  </article>`;
}

// No-vig win chance for the away team, from the two moneylines.
function awayWinPct(game) {
  const [away, home] = game.ml;
  if (!away?.price || !home?.price) return null;
  return Math.round((100 * away.price) / (away.price + home.price));
}

// A vertical bar beside the team rows: the top part is the away team's win chance, the
// bottom part the home team's, so each share sits next to the team it belongs to.
function winBar(game) {
  const awayPct = awayWinPct(game);
  if (awayPct === null) return '';
  const colors = matchupColors(game.away, game.home);
  return `
    <div class="win-bar" style="grid-area:2/1/5/2" title="${esc(game.away)} ${awayPct}% · ${esc(game.home)} ${100 - awayPct}%">
      <span style="flex-basis:${awayPct}%;background:${colors.away}"></span>
      <span style="flex-basis:${100 - awayPct}%;background:${colors.home}"></span>
    </div>`;
}

// Horizontal strip of every line, between the two team rows. Scroll it and the
// buttons above and below follow. Spread values read from the away (top) team's side.
function strip(game, type, key, index, area) {
  const ladder = game[type];
  return `
    <div class="strip" data-ladder="${esc(key)}" style="grid-area:${area}">
      ${ladder.rungs.map((r, i) => {
        const cls = ['strip-item', i === index && 'on'].filter(Boolean).join(' ');
        return `<div class="${cls}">${type === 'spread' ? fmtLine(r.away.line) : r.line}</div>`;
      }).join('')}
    </div>`;
}

function cell(opt, type, area, cellId) {
  const style = `style="grid-area:${area}"${cellId ? ` data-cell="${esc(cellId)}"` : ''}`;
  if (!opt) return `<span class="cell cell-empty" ${style}>—</span>`;
  const holderId = Object.entries(picks()).find(([, p]) => p.optKey === opt.key)?.[0];
  const mine = holderId && holderId === state.me;
  const holder = holderId && !mine ? memberById(holderId) : null;
  const blocked = !mine && !holder && clashFor(state.slip, state.me, opt);
  const disabled = !mine && (!!holder || !!blocked || !opt.available || state.slip.settings.locked);
  const main = signed(type === 'ml' ? fmtOdds(opt.price) : type === 'spread' ? fmtLine(opt.line) : `${opt.key.endsWith(':yes') ? 'O' : 'U'} ${opt.line}`);
  const cls = ['cell', type === 'ml' && 'cell-ml', mine && 'mine', mine && state.justPicked === opt.key && 'just-picked', holder && 'taken', blocked && 'blocked', state.busyKey === opt.key && 'busy'].filter(Boolean).join(' ');
  return `
    <button class="${cls}" ${style} data-action="choose" data-key="${esc(opt.key)}" ${disabled ? 'aria-disabled="true"' : ''}>
      <span class="cell-main">${main}</span>
      ${cellSub(type, opt)}
      ${holder ? sticker(holder, opt.key) : ''}
    </button>`;
}

// A league mate's pick gets their avatar stuck on like a sticker: same spot and tilt
// every render (seeded from who and what), but a little different on every cell, so it
// looks placed by hand. New ones get slapped on with a bounce.
function sticker(member, key) {
  const id = `${member.id}:${key}`;
  const rand = seeded(id);
  const fresh = state.stickersPrimed && !state.seenStickers.has(id);
  state.seenStickers.add(id);
  // Tilt 7–18° either way: never so straight it looks placed by a machine.
  const tilt = (rand() < 0.5 ? -1 : 1) * Math.round(7 + rand() * 11);
  const vars = `--rot:${tilt}deg;--dx:${Math.round(-6 + rand() * 6)}px;--dy:${Math.round(-6 + rand() * 7)}px`;
  return `<span class="sticker ${fresh ? 'slap' : ''}" style="${vars}" title="${esc(member.name)} has this">${avatar(member, 19)}</span>`;
}

// Tiny deterministic random (FNV-1a hash into xorshift): same input, same numbers.
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

// Second line of a cell: the odds (moneyline cells show odds as their main number).
function cellSub(type, opt) {
  return type === 'ml' ? '' : `<span class="cell-sub">${signed(fmtOdds(opt.price))}</span>`;
}

// ---------- research pages: a team's season, and a head-to-head matchup ----------

function openPage(entry) {
  state.pages.push(entry);
  state.resetPageScroll = true;
  loadResearch();
  if (entry.kind === 'matchup') loadPastMeetings(entry.gameId);
  render();
}

async function loadPastMeetings(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  const key = game && `${game.away}@${game.home}`;
  if (!game || state.pastMeetings.has(key)) return;
  state.pastMeetings.set(key, 'loading');
  try {
    state.pastMeetings.set(key, await sports.loadPastMeetings(game.away, game.home, Number(state.slip.season)));
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
    const [results, stats] = await Promise.all([
      sports.loadSeasonResults(Number(state.slip.season), Number(state.slip.week)),
      api.fetchSeasonStats(state.slip.season),
    ]);
    r.league = buildLeague(results, stats);
  } catch (e) {
    r.error = e.message;
  }
  r.loading = false;
  render();
}

// Research pages open as a tall sheet. The back/close buttons sit in the top corners
// over the hero; once you scroll, the top bar turns solid and shows a title.
function renderPage() {
  const current = state.pages.at(-1);
  const game = current.kind === 'matchup' ? state.games.find((g) => g.id === current.gameId) : null;
  const title = current.kind === 'team'
    ? `<span class="ts-side">${teamLogo(current.abbr, 20)}<b>${esc(state.sports?.teams.get(current.abbr)?.name ?? current.abbr)}</b></span>`
    : game ? `<span class="ts-side">${teamLogo(game.away, 20)}<b>${esc(game.away)}</b></span><span class="ts-side"><b>${esc(game.home)}</b>${teamLogo(game.home, 20)}</span>` : '';
  const content = current.kind === 'team' ? renderTeamPage(current.abbr) : renderMatchupPage(current.gameId);
  return `
  <div class="sheet-backdrop" data-action="close-page"></div>
  <div class="tsheet" role="dialog" aria-label="Research">
    <div class="ts-bar" style="${barColors(current, game)}">
      ${state.pages.length > 1 ? `<button class="round-btn" data-action="page-back" aria-label="Back">${chevron('left')}</button>` : '<span class="round-spacer"></span>'}
      <span class="ts-title" data-action="page-top">${title}</span>
      <button class="round-btn" data-action="close-page" aria-label="Close">${chevron('down')}</button>
    </div>
    <div class="tsheet-body">${content}</div>
  </div>`;
}

// Team colors for the top bar's tint once it turns solid: one team's color across a
// team page; away fading into home on a matchup.
function barColors(page, game) {
  if (page.kind === 'team') {
    const c = TEAM_COLORS[page.abbr]?.[0] ?? '#4b5a85';
    return `--bar-left:${c};--bar-right:${c}`;
  }
  if (!game) return '';
  const colors = matchupColors(game.away, game.home);
  return `--bar-left:${colors.away};--bar-right:${colors.home}`;
}

// Solid top bar once the page scrolls past the hero.
function syncPageBar() {
  const body = $app.querySelector('.tsheet-body');
  $app.querySelector('.ts-bar')?.classList.toggle('solid', (body?.scrollTop ?? 0) > 70);
}
$app.addEventListener('scroll', (e) => e.target.classList?.contains('tsheet-body') && syncPageBar(), true);

const researchLoading = () => {
  if (state.research.error) return `<p class="muted center-note">Couldn’t load season data: ${esc(state.research.error)}</p>`;
  return '<div class="loading-block small"><div class="spinner"></div><p class="muted">Loading the season…</p></div>';
};

const fmt1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : '—');
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;

// Rank tiers: top quarter of the league reads green, bottom quarter red.
function rankTier(rank, size) {
  if (!rank) return '';
  if (rank <= Math.ceil(size / 4)) return 'top';
  if (rank > size - Math.ceil(size / 4)) return 'bottom';
  return '';
}

function rankRow(label, value, rank, size) {
  const pct = rank ? ((size - rank + 1) / size) * 100 : 0;
  return `
    <div class="rk-row">
      <span class="rk-label">${label}</span>
      <span class="rk-val">${value}</span>
      <span class="rk-pill ${rankTier(rank, size)}">${rank ? ordinal(rank) : '—'}</span>
      <span class="rk-bar"><i class="${rankTier(rank, size)}" style="width:${pct}%"></i></span>
    </div>`;
}

function resultPill(g) {
  return `<span class="res res-${g.result}">${g.result}</span>`;
}

function playerLine(p) {
  const s = p.stats;
  const gp = s.gp || 1;
  const n = (v) => Math.round(v ?? 0).toLocaleString();
  switch (p.player.position) {
    case 'QB': return { line: `${n(s.pass_yd)} yds · ${n(s.pass_td)} TD · ${n(s.pass_int)} INT${s.rush_yd > 80 ? ` · ${n(s.rush_yd)} rush` : ''}`, per: fmt1((s.pass_yd ?? 0) / gp), unit: 'pass yds/g' };
    case 'RB': return { line: `${n(s.rush_att)} car · ${n(s.rush_yd)} yds · ${n(s.rush_td)} TD · ${n(s.rec)} rec`, per: fmt1(((s.rush_yd ?? 0) + (s.rec_yd ?? 0)) / gp), unit: 'scrim yds/g' };
    default: return { line: `${n(s.rec)} rec · ${n(s.rec_tgt)} tgt · ${n(s.rec_yd)} yds · ${n(s.rec_td)} TD`, per: fmt1((s.rec_yd ?? 0) / gp), unit: 'rec yds/g' };
  }
}

function renderTeamPage(abbr) {
  const info = state.sports?.teams.get(abbr);
  const league = state.research.league;
  const t = league?.teams.get(abbr);
  const color = TEAM_COLORS[abbr]?.[0] ?? '#4b5a85';
  const upNext = state.games.find((g) => (g.away === abbr || g.home === abbr) && !g.locked);
  const opp = upNext && (upNext.home === abbr ? upNext.away : upNext.home);
  const size = league?.size ?? 32;
  const diff = t ? t.pointsFor - t.pointsAgainst : null;
  const [divRank, ...divName] = (info?.standing ?? '').split(' in ');

  const stat = (label, value, cls = '') => `<div class="info-cell ${cls}"><b>${value ?? '—'}</b><small>${label}</small></div>`;
  const hero = `
    <div class="tp-hero" style="--team:${color}">
      <span class="logo-disc">${teamLogo(abbr, 72)}</span>
      <h2>${esc(info?.name ?? abbr)}</h2>
    </div>
    ${upNext ? `
      <button class="tp-next" data-action="matchup" data-id="${esc(upNext.id)}">
        <span class="tp-next-tag">This week</span>
        <b>${upNext.home === abbr ? 'vs' : '@'} ${teamLogo(opp, 20)} ${esc(state.sports?.teams.get(opp)?.name?.split(' ').slice(-1)[0] ?? opp)}</b>
        <small>${esc(dayTimeFmt.format(upNext.start))}</small>
        <span class="tp-next-go">${chevronSmall()}</span>
      </button>` : ''}
    <div class="info-grid">
      ${stat('Record', esc(t?.record ?? info?.record ?? '—'))}
      ${stat(esc(divName.join(' in ') || 'Division'), esc(divRank || '—'))}
      ${stat('Streak', esc(info?.streak ?? '—'))}
      ${stat('Home', esc(info?.homeRecord ?? '—'))}
      ${stat('Road', esc(info?.roadRecord ?? '—'))}
      ${stat('Point diff', diff === null ? '—' : `${diff > 0 ? '+' : ''}${diff}`, diff > 0 ? 'good' : diff < 0 ? 'bad' : '')}
    </div>`;

  if (!league) return hero + researchLoading();
  if (!t) return hero + '<p class="muted center-note">No games yet this season.</p>';

  // Offense and defense as two wide cards: the header row carries the overall rank
  // (points scored or allowed per game), then that unit's numbers sit side by side.
  const unitCard = (label, rank, value, unit, cells) => `
    <div class="cmp unit-card">
      <div class="card-head"><span>${label}</span><span class="unit-rank"><b>${value}</b><small>${unit}</small><span class="rk-pill ${rankTier(rank, size)}">${ordinal(rank)}</span></span></div>
      <div class="unit-cells">${cells}</div>
    </div>`;

  return `${hero}
    ${unitCard('Offense', t.ranks.points, fmt1(t.per.points), 'pts/g',
      rankRow('YDS / G', fmt1(t.per.yards), t.ranks.yards, size)
      + rankRow('PASS YDS / G', fmt1(t.per.passYd), t.ranks.passYd, size)
      + rankRow('RUSH YDS / G', fmt1(t.per.rushYd), t.ranks.rushYd, size))}
    ${unitCard('Defense', t.ranks.allowed, fmt1(t.per.allowed), 'opp pts/g',
      rankRow('OPP YDS / G', fmt1(t.per.yardsAllowed), t.ranks.yardsAllowed, size)
      + rankRow('SACKS', t.per.sacks, t.ranks.sacks, size)
      + rankRow('TAKEAWAYS', t.per.takeaways, t.ranks.takeaways, size))}

    <div class="cmp">
      <div class="card-head"><span>Season</span></div>
      <ol class="sched${t.games.some((g) => g.week >= 10) ? ' wide-wk' : ''}">
        ${t.games.map((g) => `
          <li class="sched-row">
            <span class="sched-wk">${g.week}</span>
            <button class="sched-opp" data-action="team" data-id="${esc(g.opp)}"><span class="sched-ha">${g.home ? 'vs' : '@'}</span>${teamLogo(g.opp, 22)}<b>${esc(g.opp)}</b></button>
            <span class="sched-chip ${g.result}">${g.result}</span>
            <span class="sched-score">${g.pf}–${g.pa}</span>
          </li>`).join('')}
      </ol>
    </div>

    ${t.starters.length ? `
      <div class="cmp">
        <div class="card-head"><span>Upcoming starters</span><small>Excl. Out/IR</small></div>
        ${t.starters.map((p) => {
          const { line, per: pg, unit } = playerLine(p);
          return `
          <div class="pl-card">
            <span class="pl-head"><img src="${esc(api.playerHeadshot(p.player_id))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></span>
            <div class="pl-body">
              <div class="pl-name">${esc(`${p.player.first_name} ${p.player.last_name}`)} <span class="pl-pos ${esc(p.player.position)}">${esc(p.player.position)}</span>${injuryTag(p.player.injury_status)}</div>
              <div class="pl-line">${esc(line)}</div>
            </div>
            <div class="pl-pg"><b>${pg}</b><small>${unit}</small></div>
          </div>`;
        }).join('')}
      </div>` : ''}`;
}

function renderMatchupPage(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return '<p class="muted center-note">This game isn’t on the board anymore.</p>';
  const { away: A, home: H } = game;
  const league = state.research.league;
  const colors = matchupColors(A, H);
  const awayPct = awayWinPct(game);
  const teamInfo = (abbr) => state.sports?.teams.get(abbr);
  const info = state.sports?.games.get(`${A}@${H}`);
  const teamHead = (abbr) => `
    <button class="mp-team" data-action="team" data-id="${esc(abbr)}" style="--team:${abbr === A ? colors.away : colors.home}">
      <span class="logo-disc">${teamLogo(abbr, 58)}</span>
      <b>${esc(teamInfo(abbr)?.name?.split(' ').slice(-1)[0] ?? abbr)}</b>
      <small>${esc(league?.teams.get(abbr)?.record ?? teamInfo(abbr)?.record ?? '')}</small>
    </button>`;

  // Game info stacked between the two teams: kickoff, network, weather.
  const mid = `
    <div class="mp-mid">
      <b>${esc(timeFmt.format(game.start))}</b>
      <span class="mp-mid-row">
        <small>${esc(shortDayFmt.format(game.start))}</small>
        ${info?.dome ? '<small>🏟️ Dome</small>' : info?.weather ? `<small>${weatherIcon(info.weather.text)} ${esc(info.weather.temp)}°</small>` : ''}
      </span>
      ${info?.tv ? `<span class="tv-list">${tvBadges(info.tv)}</span>` : ''}
    </div>`;

  const head = `
    <div class="mp-hero">
      <div class="mp-head">${teamHead(A)}${mid}${teamHead(H)}</div>
      ${awayPct !== null ? `
        <div class="mp-win">
          <span>${awayPct}%</span>
          <div class="mp-win-bar"><i style="flex-basis:${awayPct}%;background:var(--away)"></i><i style="flex-basis:${100 - awayPct}%;background:var(--home)"></i></div>
          <span>${100 - awayPct}%</span>
        </div>` : ''}
    </div>`;

  // Team colors for everything on this page (hero gradient, bars).
  const wrap = (html) => `<div class="mp" style="--away:${colors.away};--home:${colors.home}">${html}</div>`;
  if (!league) return wrap(head + researchLoading());
  const a = league.teams.get(A);
  const h = league.teams.get(H);
  if (!a || !h) return wrap(head + '<p class="muted center-note">Not enough games yet to compare.</p>');
  const size = league.size;
  const show = (v) => (Number.isInteger(v) ? String(v) : fmt1(v));
  const rank = (r) => (r ? `<small class="rk ${rankTier(r, size)}">${ordinal(r)}</small>` : '');
  // Each card's first row names the section, between the two teams' columns.
  const cmpHead = (title) => `<div class="cmp-head"><span>${teamLogo(A, 16)}${esc(A)}</span><span class="cmp-title">${title}</span><span>${esc(H)}${teamLogo(H, 16)}</span></div>`;

  // Away value hugs the left edge, home value the right edge; the label and a bar in
  // team colors sit between (the bigger share of the bar is the better number).
  const compareRow = (label, av, hv, aRank, hRank, higherIsBetter = true, bar = true) => {
    const goodA = higherIsBetter ? av : hv;
    const goodH = higherIsBetter ? hv : av;
    const aShare = goodA + goodH ? Math.round((100 * goodA) / (goodA + goodH)) : 50;
    const numeric = typeof av === 'number' && typeof hv === 'number';
    const aBetter = numeric && (higherIsBetter ? av > hv : av < hv);
    const hBetter = numeric && (higherIsBetter ? hv > av : hv < av);
    return `
      <div class="cmp-row">
        <span class="cmp-val ${aBetter ? 'better' : ''}"><b>${typeof av === 'number' ? show(av) : esc(av)}</b>${rank(aRank)}</span>
        <span class="cmp-mid">
          <span class="cmp-label">${label}</span>
          ${bar ? `<span class="cmp-bar"><i style="flex-basis:${aShare}%;background:var(--away)"></i><i style="flex-basis:${100 - aShare}%;background:var(--home)"></i></span>` : ''}
        </span>
        <span class="cmp-val right ${hBetter ? 'better' : ''}"><b>${typeof hv === 'number' ? show(hv) : esc(hv)}</b>${rank(hRank)}</span>
      </div>`;
  };

  const tape = [
    ['PTS / G', 'points', true],
    ['OPP PTS / G', 'allowed', false],
    ['PASS YDS / G', 'passYd', true],
    ['RUSH YDS / G', 'rushYd', true],
    ['OPP YDS / G', 'yardsAllowed', false],
    ['SACKS', 'sacks', true],
    ['TAKEAWAYS', 'takeaways', true],
  ].map(([label, key, higher]) => compareRow(label, a.per[key], h.per[key], a.ranks[key], h.ranks[key], higher)).join('');

  // Same layout as compareRow, without a winner or bar: for rows where the two sides
  // measure different things (an offense's points vs a defense's points allowed).
  const plainRow = (label, left, right, lRank, rRank) => `
    <div class="cmp-row">
      <span class="cmp-val plain"><b>${typeof left === 'number' ? show(left) : esc(left)}</b>${rank(lRank)}</span>
      <span class="cmp-mid"><span class="cmp-label">${label}</span></span>
      <span class="cmp-val plain right"><b>${typeof right === 'number' ? show(right) : esc(right)}</b>${rank(rRank)}</span>
    </div>`;

  // Offense vs defense in one card, away team on the left throughout: first the away
  // offense against the home defense, then the away defense against the home offense.
  const offDef = `
    <div class="cmp">
      ${cmpHead('Offense vs defense')}
      <div class="cmp-sub"><span>Offense</span><span>Defense</span></div>
      ${plainRow('PTS / G', a.per.points, h.per.allowed, a.ranks.points, h.ranks.allowed)}
      ${plainRow('YDS / G', a.per.yards, h.per.yardsAllowed, a.ranks.yards, h.ranks.yardsAllowed)}
      <div class="cmp-sub"><span>Defense</span><span>Offense</span></div>
      ${plainRow('PTS / G', a.per.allowed, h.per.points, a.ranks.allowed, h.ranks.points)}
      ${plainRow('YDS / G', a.per.yardsAllowed, h.per.yards, a.ranks.yardsAllowed, h.ranks.yards)}
    </div>`;

  const ra = resume(league, A);
  const rh = resume(league, H);
  const signedNum = (n) => `${n > 0 ? '+' : ''}${fmt1(n)}`;

  const meetingsThisSeason = headToHead(league, A, H);
  const past = state.pastMeetings.get(`${A}@${H}`);
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
  // Sleeper numbers playoff weeks 1-4: wild card through the Super Bowl.
  const conference = Object.keys(sports.DIVISIONS).find((d) => sports.DIVISIONS[d].includes(A))?.slice(0, 3);
  const playoffRound = (week) => ['Wild Card', 'Divisional', `${conference} Championship`, 'Super Bowl'][week - 1] ?? 'Playoffs';
  const meetingRow = ([when, detail], aScore, hScore) => `
    <div class="meet-row">
      <span class="meet-when"><small>${esc(when)}</small>${detail ? `<small class="faint">${esc(detail)}</small>` : ''}</span>
      <span class="meet-score"><b class="${aScore > hScore ? 'won' : ''}">${aScore}</b><span>–</span><b class="${hScore > aScore ? 'won' : ''}">${hScore}</b></span>
      <small class="right">${aScore > hScore ? esc(A) : hScore > aScore ? esc(H) : 'Tie'}</small>
    </div>`;
  const meetings = [
    ...meetingsThisSeason.map((g) => meetingRow(['This season', `Week ${g.week}`], g.pf, g.pa)),
    ...(Array.isArray(past) ? past.map((m) => {
      const aScore = m.away === A ? m.status.awayScore : m.status.homeScore;
      const hScore = m.away === A ? m.status.homeScore : m.status.awayScore;
      return meetingRow([monthFmt.format(new Date(m.start)), m.playoff ? playoffRound(m.week) : null], aScore, hScore);
    }) : []),
  ];

  // Common opponents, earliest meeting first. Each side lines up the same way:
  // result, score, then week and home/away underneath.
  const common = commonOpponents(league, A, H)
    .sort((x, y) => Math.min(...x.a.map((g) => g.week), ...x.b.map((g) => g.week)) - Math.min(...y.a.map((g) => g.week), ...y.b.map((g) => g.week)));
  const gameLine = (g, side) => `
    <span class="gl ${side}"><span class="gl-res ${g.result}">${g.result}</span><b>${g.pf}–${g.pa}</b><small>Wk ${g.week} · ${g.home ? 'home' : 'away'}</small></span>`;

  // Win chains through two other teams (one-team links already show as common
  // opponents). Drawn away → home; "A > B" means A beat B, and each score is written
  // left team's points first.
  const chains = [
    ...winChains(league, A, H).filter((c) => c.length >= 3).slice(0, 3).map((links) => ({ links, forward: true })),
    ...winChains(league, H, A).filter((c) => c.length >= 3).slice(0, 3).map((links) => ({ links: [...links].reverse(), forward: false })),
  ];
  const chainView = ({ links, forward }) => {
    const teams = forward ? [links[0].winner, ...links.map((l) => l.loser)] : [links[0].loser, ...links.map((l) => l.winner)];
    return `
      <div class="chain-row">
        ${teams.map((team, i) => {
          if (!i) return `<span class="chain-team">${teamLogo(team, 22)}<small>${esc(team)}</small></span>`;
          const link = links[i - 1];
          const [w, l] = link.score.split('-');
          // The sign sits alone between the logos; the score (left team's points
          // first, winner's bright) and week stack under it, so logo width never matters.
          const [left, right] = forward ? [w, l] : [l, w];
          return `
            <span class="chain-link">
              <i>${forward ? '&gt;' : '&lt;'}</i>
              <span class="cl-score"><b class="${forward ? 'won' : ''}">${left}</b>–<b class="${forward ? '' : 'won'}">${right}</b></span>
              <small>Wk ${link.week}</small>
            </span>
            <span class="chain-team">${teamLogo(team, 22)}<small>${esc(team)}</small></span>`;
        }).join('')}
      </div>`;
  };

  const emptyRow = (text) => `<p class="cmp-empty">${text}</p>`;

  return wrap(`${head}
    <div class="cmp">${cmpHead('Tale of the tape')}${tape}</div>

    ${offDef}

    <div class="cmp">
      ${cmpHead('Track record')}
      ${plainRow('VS WINNING TEAMS', ra.vsWinning, rh.vsWinning)}
      ${plainRow('LAST 3', ra.last3, rh.last3)}
      ${plainRow('ROAD · HOME', ra.road, rh.home)}
      ${plainRow('AVG MARGIN', signedNum(ra.margin), signedNum(rh.margin))}
    </div>

    <div class="cmp">
      ${cmpHead('Last meetings')}
      ${meetings.length ? meetings.join('')
        : past === 'loading' ? '<div class="spinner small"></div>' : emptyRow('No meetings in the last three seasons.')}
    </div>

    <div class="cmp">
      ${cmpHead('Common opponents')}
      ${common.length ? `
        <div class="common-sum"><b>${recordOf(common.flatMap((c) => c.a))}</b><b>${recordOf(common.flatMap((c) => c.b))}</b></div>
        ${common.map((c) => `
          <div class="common-row">
            <span class="common-side">${c.a.map((g) => gameLine(g, 'left')).join('')}</span>
            <button class="common-opp" data-action="team" data-id="${esc(c.opp)}">${teamLogo(c.opp, 24)}<small>${esc(c.opp)}</small></button>
            <span class="common-side right">${c.b.map((g) => gameLine(g, 'right')).join('')}</span>
          </div>`).join('')}` : emptyRow('They haven’t played any of the same teams yet.')}
    </div>

    ${chains.length ? `
      <div class="cmp chains">
        ${cmpHead('Win chains')}
        ${chains.map(chainView).join('')}
        <p class="cmp-empty">A &gt; B means A beat B. Scores read left team first.</p>
      </div>` : ''}`);
}

// Short injury badge: Q, D, OUT, IR, PUP...
function injuryTag(status) {
  if (!status) return '';
  const short = { questionable: 'Q', doubtful: 'D', out: 'OUT', 'injured reserve': 'IR' }[status.toLowerCase()] ?? status.slice(0, 3).toUpperCase();
  return ` <span class="pl-inj" title="${esc(status)}">${esc(short)}</span>`;
}

const teamChip = (abbr) => `<span class="team-chip">${teamLogo(abbr, 18)}${esc(abbr)}</span>`;

// The parlay in three parts, so the phone sheet can pin the header and footer while
// the legs scroll, and the desktop sidebar can stack them in one card.
const chevronSmall = () =>
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

const chevron = (dir) =>
  `<svg class="chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${{ up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', left: 'M15 6l-6 6 6 6' }[dir]}"/></svg>`;

// Once the first leg's game kicks off (or the slip is locked), the slip switches to
// tracking: live scores, live chances, and hit/miss as games finish.
const isTracking = (legs) => !!state.slip?.settings.locked || legs.some((l) => l.status && l.status.state !== 'pre');

// The slip's top row (also the peek when it's closed): who's in, or once tracking, a
// tally of hits, misses, and live legs; then your leg and the open/close chevron.
function slipHeader(withChevron) {
  const legs = legsWithLive();
  const mine = picks()[state.me];
  let left;
  if (isTracking(legs)) {
    const count = (grade, live) => legs.filter((l) => (live ? l.status?.state === 'in' : l.status?.state === 'post' && l.grade === grade)).length;
    const hit = count('hit') + count('push');
    const miss = count('miss');
    const live = count(null, true);
    left = `
      <span class="tally">
        ${miss ? '<span class="tally-bust">Busted</span>' : hit === legs.length ? '<span class="tally-cash">Cashed</span>' : ''}
        <span class="t-hit">✓ ${hit}</span><span class="t-miss">✗ ${miss}</span><span class="t-live">● ${live}</span>
        <small>of ${legs.length}</small>
      </span>`;
  } else {
    // While your avatar is in flight, faces keep the order from before your pick.
    const shown = state.facesHold ? state.facesHold.map((id) => legs.find((l) => l.member.id === id)).filter(Boolean) : legs;
    const faces = shown.slice(0, 6).map((l) => avatar(l.member, 24, 'stacked')).join('');
    left = `<span class="faces">${shown.length ? faces : '<span class="faces-empty">No legs yet</span>'}${shown.length > 6 ? `<small>+${shown.length - 6}</small>` : ''}</span>`;
  }
  return `
    <div class="slip-peek">
      ${left}
      <span class="peek-right">
        ${mine ? myLegChip(mine) : '<span class="my-leg empty">Add your leg</span>'}
        ${withChevron ? `<span class="slip-chev round-btn">${chevron('up')}</span>` : ''}
      </span>
    </div>`;
}

// Which team a pick backs, and how to describe the matchup from that team's side.
function pickTeams(pick) {
  const [away, home] = pick.matchup.split(' @ ');
  if (pick.type === 'total') return { team: null, away, home, vs: `${away} @ ${home}` };
  const team = pick.label.split(' ')[0];
  return { team, away, home, vs: team === away ? `@ ${home}` : `vs ${away}` };
}

function parlayLegs() {
  const legs = legsWithLive();
  if (!legs.length) {
    return `
      <div class="empty">
        <div class="empty-icon">🎟️</div>
        <p>No legs yet.<br><span class="muted">Tap a line to add the first one.</span></p>
      </div>`;
  }
  const tracking = isTracking(legs);
  return `<ol class="legs ${tracking ? 'tracking' : ''}">${legs.map((l) => {
    const { team, away, home, vs } = pickTeams(l.pick);
    const logo = team
      ? teamLogo(team, 28)
      : `<span class="logo-pair">${teamLogo(away, 18)}${teamLogo(home, 18)}</span>`;
    const isMine = l.member.id === state.me;
    const st = l.status;
    const live = st?.state === 'in';
    const final = st?.state === 'post';
    const score = st && st.state !== 'pre' ? `${away} ${st.awayScore}–${st.homeScore} ${home}` : '';
    const stamp = final ? `<span class="ink-stamp ${l.grade}" style="--rot:${Math.round(-14 + seeded(l.pick.optKey)() * 10)}deg">${l.grade === 'hit' ? 'HIT' : l.grade === 'miss' ? 'MISS' : 'PUSH'}</span>` : '';

    if (tracking) {
      // Tracking row: the pick, then the game's score and clock underneath; on the
      // right, the chance now (live market) and where it started, green if it's up.
      const sub = live
        ? `<span class="live-tag ${l.grade}">● ${esc(st.detail)}</span><span>${esc(score)}</span>`
        : final ? `<span>Final</span><span>${esc(score)}</span>` : `<span>${esc(vs)} · ${esc(dayTimeFmt.format(l.pick.start))}</span>`;
      const now = final ? (l.grade === 'miss' ? 0 : 100) : live && l.livePrice ? l.livePrice : l.price;
      const delta = now - l.pick.price;
      return `
        <li class="leg ${isMine ? 'leg-you' : ''} ${live ? 'leg-live' : ''} ${final ? `leg-final ${l.grade}` : ''}">
          <span class="leg-logo">${logo}${avatar(l.member, 18, 'leg-face')}</span>
          <div class="leg-body">
            <span class="leg-pick">${esc(pretty(l.pick.label))}${isMine ? ' <em class="you-tag">You</em>' : ''}</span>
            <span class="leg-sub">${sub}</span>
          </div>
          ${stamp}
          <div class="leg-right">
            <span class="leg-odds">${final ? '' : fmtOdds(now)}</span>
            <small class="leg-from ${final ? '' : delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${final ? esc(l.member.name) : `${delta > 0 ? '▲' : delta < 0 ? '▼' : 'from'} ${fmtOdds(l.pick.price)}`}</small>
          </div>
        </li>`;
    }

    const sub = `${esc(vs)} · ${esc(dayTimeFmt.format(l.pick.start))}`;
    return `
      <li class="leg ${isMine ? 'leg-mine' : ''}">
        <span class="leg-logo">${logo}${avatar(l.member, 18, 'leg-face')}</span>
        <div class="leg-body">
          <span class="leg-pick">${esc(pretty(l.pick.label))}</span>
          <span class="leg-sub">${sub}</span>
        </div>
        <div class="leg-right">
          <span class="leg-odds">${fmtOdds(l.price)}</span>
          ${isMine && !state.slip.settings.locked
            ? '<button class="leg-who leg-remove" data-action="remove-mine">Remove</button>'
            : `<span class="leg-who">${isMine ? 'You' : esc(l.member.name)}</span>`}
        </div>
      </li>`;
  }).join('')}</ol>`;
}

// Receipt-style totals: leg count, fair odds, and what that would pay. Fair means each
// leg's price with the vig removed, multiplied together. While tracking, the chance is
// recomputed live: finished legs count as 100% (hit or push) or 0% (miss), live legs use
// the market's current price, the rest their current price.
function parlayFoot() {
  const legs = legsWithLive();
  if (!legs.length) return '';
  const fair = fairParlay(legs);
  if (!isTracking(legs)) {
    return `
      <dl class="parlay-foot" title="Each leg's price with the vig removed, multiplied together. Use it to judge the price you get.">
        <div><dt>Legs</dt><dd>${legs.length}</dd></div>
        <div><dt>${state.oddsFormat === 'pct' ? 'Fair chance' : 'Fair odds'}</dt><dd>${fair.odds}</dd></div>
        <div><dt>Fair payout</dt><dd>${fair.mult}×</dd></div>
      </dl>`;
  }
  const liveProb = legs.reduce((acc, l) => {
    if (l.status?.state === 'post') return acc * (l.grade === 'miss' ? 0 : 1);
    return acc * (l.liveFair ?? l.fair);
  }, 1);
  const startProb = legs.reduce((acc, l) => acc * (l.pick.fair ?? l.pick.price / 100), 1);
  const pct = (p) => (p >= 0.1 ? `${(p * 100).toFixed(0)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : p > 0 ? `${(p * 100).toFixed(2)}%` : '0%');
  const busted = legs.some((l) => l.status?.state === 'post' && l.grade === 'miss');
  const hits = legs.filter((l) => l.status?.state === 'post' && l.grade !== 'miss').length;
  return `
    <dl class="parlay-foot ${busted ? 'busted' : ''}">
      <div><dt>Legs hit</dt><dd>${hits} of ${legs.length}</dd></div>
      <div><dt>Chance now</dt><dd>${pct(liveProb)} <small class="${liveProb > startProb ? 'up' : liveProb < startProb ? 'down' : ''}">from ${pct(startProb)}</small></dd></div>
      <div><dt>Fair payout</dt><dd>${fair.mult}×</dd></div>
    </dl>`;
}

// Desktop: the same ticket as the phone slip, always open in the sidebar.
function renderParlayCard() {
  return `<div class="parlay-card ticket"><div class="paper" aria-hidden="true"></div>${slipHeader(false)}<div class="sheet-body">${parlayLegs()}</div>${parlayFoot()}</div>`;
}

// Phone: the slip lives at the bottom of the screen. Closed, its top edge peeks up
// (who's in, your leg); drag it or tap it to pull up the full slip. It's one element in
// both states, so it never jumps or changes width.
function renderSlip() {
  const classes = ['slip-wrap', state.sheetOpen && 'open', isTracking(legsWithLive()) && 'tracking'].filter(Boolean).join(' ');
  return `
  <div class="${classes}">
    <div class="slip-backdrop" data-action="close-sheet"></div>
    <section class="slip" aria-label="The parlay">
      <div class="paper" aria-hidden="true"></div>
      <div class="slip-handle" role="button" tabindex="0" aria-expanded="${state.sheetOpen}" aria-label="Show or hide the parlay">
        ${slipHeader(true)}
      </div>
      <div class="sheet-body">${parlayLegs()}</div>
      ${parlayFoot()}
    </section>
  </div>`;
}

// Puts the paper's side notches exactly on the tear line above the totals: the mask
// cuts them at --tear from the bottom, so tell it how tall the footer is.
function syncTearLine() {
  for (const paper of $app.querySelectorAll('.slip .paper, .ticket .paper')) {
    const foot = paper.parentElement.querySelector(':scope > .parlay-foot');
    if (!foot || !paper.offsetHeight) continue; // hidden at this screen size
    const fromBottom = paper.getBoundingClientRect().bottom - foot.getBoundingClientRect().top;
    // Desktop's body mask box is inset 5px from the bottom.
    paper.style.setProperty('--tear', `${fromBottom - (paper.closest('.ticket') ? 5 : 0)}px`);
  }
}

window.addEventListener('resize', () => requestAnimationFrame(syncTearLine));

// Once per browser, after the lines load, bounce the closed slip so people notice it
// pulls up. Added straight to the DOM (not via render) so a redraw can't restart it.
function nudgeSlip() {
  if (!state.slipNudge) return;
  state.slipNudge = false;
  safeSet('parlay:nudged', '1');
  const wrap = $app.querySelector('.slip-wrap');
  if (!wrap || state.sheetOpen) return;
  wrap.classList.add('nudge');
  setTimeout(() => $app.querySelector('.slip-wrap')?.classList.remove('nudge'), 1600);
}

// Your leg, shortened: the team logo (both logos for a total) and just the number,
// e.g. [JAX] −9.5, [KC] ML, [MIN][DET] U 45.5.
function myLegChip(pick) {
  const { team, away, home } = pickTeams(pick);
  const logos = team ? teamLogo(team, 18) : `${teamLogo(away, 16)}${teamLogo(home, 16)}`;
  const short = pick.type === 'ml' ? 'ML' : pick.type === 'total' ? pick.label.replace(/^(Over|Under) /, (m) => `${m[0]} `) : pretty(pick.label.split(' ').slice(1).join(' '));
  return `<span class="my-leg">${logos}<b>${esc(short)}</b></span>`;
}

// Open/close without a full re-render, so the slide animates from where it is.
function setSlip(open) {
  state.sheetOpen = open;
  state.slipNudge = false;
  const wrap = $app.querySelector('.slip-wrap');
  wrap?.classList.toggle('open', open);
  wrap?.querySelector('.slip-handle')?.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('no-scroll', open || state.pages.length > 0);
  if (!open) wrap?.querySelector('.sheet-body')?.scrollTo(0, 0);
}

// Drag the slip by its top edge; it follows the finger, then snaps open or closed
// based on where it's let go and how fast it was moving. A tap toggles it.
let slipDrag = null;
$app.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.slip-handle');
  if (!handle) return;
  const slip = handle.closest('.slip');
  const closedY = slip.offsetHeight - handle.offsetHeight - safeBottom();
  slipDrag = { slip, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, base: state.sheetOpen ? 0 : closedY, closedY, moved: false };
  slip.style.transition = 'none';
  handle.setPointerCapture(e.pointerId);
});
$app.addEventListener('pointermove', (e) => {
  if (!slipDrag) return;
  const d = slipDrag;
  const dy = e.clientY - d.startY;
  if (Math.abs(dy) > 5) d.moved = true;
  if (!d.moved) return;
  d.velocity = (e.clientY - d.lastY) / Math.max(1, e.timeStamp - d.lastT);
  d.lastY = e.clientY;
  d.lastT = e.timeStamp;
  d.y = Math.min(d.closedY, Math.max(0, d.base + dy));
  d.slip.style.transform = `translateY(${d.y}px)`;
  $app.querySelector('.slip-backdrop').style.opacity = String(1 - d.y / d.closedY);
});
const endSlipDrag = () => {
  if (!slipDrag) return;
  const d = slipDrag;
  slipDrag = null;
  if (d.pendingRender) setTimeout(render, 400);
  d.slip.style.transition = '';
  d.slip.style.transform = '';
  $app.querySelector('.slip-backdrop').style.opacity = '';
  if (!d.moved) return setSlip(!state.sheetOpen);
  const flungUp = d.velocity < -0.4;
  const flungDown = d.velocity > 0.4;
  setSlip(flungUp || (!flungDown && d.y < d.closedY / 2));
};
$app.addEventListener('pointerup', endSlipDrag);
$app.addEventListener('pointercancel', endSlipDrag);
$app.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.slip-handle')) {
    e.preventDefault();
    setSlip(!state.sheetOpen);
  }
});

let safeArea = null;
function safeBottom() {
  if (safeArea === null) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom);visibility:hidden';
    document.body.appendChild(probe);
    safeArea = probe.offsetHeight;
    probe.remove();
  }
  return safeArea;
}

// ---------- events ----------

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action, id, key } = el.dataset;

  switch (action) {
    case 'choose': return choose(key);
    case 'team': return openPage({ kind: 'team', abbr: id });
    case 'matchup': return openPage({ kind: 'matchup', gameId: id });
    case 'page-back':
      state.pages.pop();
      state.resetPageScroll = true;
      return render();
    case 'close-page':
      state.pages = [];
      return render();
    // Tapping the solid top bar's title scrolls the page back to the top.
    case 'page-top':
      return $app.querySelector('.tsheet-body')?.scrollTo({ top: 0, behavior: 'smooth' });
    case 'toggle-started':
      state.showStarted = !state.showStarted;
      return render();
    case 'be':
      state.me = id;
      state.switchingUser = false;
      safeSet(`parlay:me:${state.slipId}`, id);
      safeSet('parlay:me', id);
      window.scrollTo(0, 0);
      return render();
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
    case 'close-sheet': return setSlip(false);
    case 'remove-mine': return removeMine();
    case 'reload-lines':
      state.lobby = null;
      return loadLines();
  }
});

$app.addEventListener('input', (e) => {
  if (e.target.id === 'league-query') state.landing.query = e.target.value;
});

$app.addEventListener('submit', (e) => {
  if (e.target.dataset.form === 'league') {
    e.preventDefault();
    landingGo();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.pages.length) {
    state.pages.pop();
    render();
  } else if (e.key === 'Escape' && state.sheetOpen) {
    setSlip(false);
  }
});

// ---------- boot ----------

if (state.slipId) startSlip();
render();
