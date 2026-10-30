// The board: top bar, day chips, deadline countdown, and the game cards with their
// pickable cells. Also the "Who's picking?" screen.
import { matchupColors } from '../teams.js';
import { awayWinPct, ladderKey, ladderSides } from '../lines.js';
import { clashFor, gameKey } from '../rules.js';
import { DEMO_MODES, beforeCutoff, gameTakers, hasStarted, isLocked, memberById, pickProblem, picks, rungIndex, scoreboardGames, state } from '../state.js';
import { LOCK_ICON, STICKER_SLAP_MS, avatar, chevronSmall, dayFmt, dayTimeFmt, esc, fmtLine, fmtOdds, pretty, seeded, shortDayFmt, signSpan, teamLogo, timeFmt, tvBadges, weatherIcon } from '../ui.js';

export const STRIP_ITEM = 36; // px, must match .strip-item width in CSS

export function renderTopbar(me) {
  const slip = state.slip;
  const legCount = Object.keys(picks()).length;
  return `
  <header class="topbar">
    <div class="topbar-league">
      ${avatar(slip.league, 34, 'league-avatar')}
      <div class="topbar-text">
        <strong>${esc(slip.league.name)}</strong>
        <small>Week ${esc(slip.week)} · ${isLocked() ? `<span class="locked-legs" title="Picks are locked">${LOCK_ICON}</span>` : ''}${legCount} ${legCount === 1 ? 'leg' : 'legs'}</small>
      </div>
    </div>
    ${state.demoMode ? demoPicker() : ''}
    ${me && !state.acting ? `
      <button class="me-chip" data-action="switch-user" aria-label="Signed in as ${esc(me.name)}. Not you?">
        <span class="me-text"><strong>${esc(me.name)}</strong><small>not you?</small></span>
        ${avatar(me, 34)}
      </button>` : ''}
  </header>`;
}

// The demo's stage, as a small pill between the league and you (app.js reloads into the
// one picked).
const demoPicker = () => `
  <label class="demo-pick ${state.demoSwitching ? 'busy' : ''}" title="Demo: show the slip at another stage of the week">
    <select id="demo-mode" aria-label="Demo stage">
      ${DEMO_MODES.map((m) => `<option value="${m.id}" ${m.id === state.demoMode ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
    </select>
  </label>`;

// Countdown to the pick deadline, as flip-clock tiles. tickClocks updates it every
// second without a re-render; at zero the page re-renders locked.
export function renderLockBar() {
  const cutoff = state.slip.settings.cutoff;
  if (!cutoff || isLocked()) return '';
  const ms = cutoff - Date.now();
  return `
    <div class="lock-bar ${ms < 3_600_000 ? 'soon' : ''}">
      <div class="lock-when">
        <span class="lock-kicker">${LOCK_ICON}Picks lock at</span>
        <strong>${esc(`${shortDayFmt.format(cutoff)} · ${timeFmt.format(cutoff)}`)}</strong>
      </div>
      <span class="flip-clock" data-until="${Number(cutoff)}">${clockTiles(ms)}</span>
    </div>`;
}

// Countdown units, biggest first, dropping leading zero units: [value, label].
export function clockParts(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const parts = [
    [Math.floor(total / 86400), 'days'],
    [Math.floor((total % 86400) / 3600), 'hrs'],
    [Math.floor((total % 3600) / 60), 'min'],
    [total % 60, 'sec'],
  ];
  const first = parts.findIndex(([v], i) => v > 0 || i >= 2);
  return parts.slice(first).map(([v, label]) => [String(v).padStart(2, '0'), label]);
}

// Each unit is a pair of flip tiles with its label underneath, with colons between units.
export const clockTiles = (ms) => clockParts(ms).map(([digits, label]) => `
  <span class="fc-unit"><span class="fc-digits">${[...digits].map((d) => `<i>${d}</i>`).join('')}</span><small>${label}</small></span>`).join('<span class="fc-sep">:</span>');

// A day section's id, from its date, so it stays the same when earlier days drop off.
const dayId = (start) => `day-${new Date(start).toDateString().replaceAll(' ', '-')}`;

export function renderSubbar() {
  const upcoming = state.games.filter((g) => !hasStarted(g));
  const days = [...new Map(upcoming.map((g) => [dayFmt.format(g.start), g.start])).values()];
  return `
  <nav class="subbar">
    <div class="day-chips">
      ${days.map((start) => `<button class="day-chip" data-action="jump" data-id="${dayId(start)}">${esc(shortDayFmt.format(start))}</button>`).join('')}
    </div>
    <div class="seg" role="group" aria-label="Odds format">
      <button class="${state.oddsFormat === 'american' ? 'on' : ''}" data-action="odds" data-id="american">+110</button>
      <button class="${state.oddsFormat === 'pct' ? 'on' : ''}" data-action="odds" data-id="pct">%</button>
    </div>
  </nav>`;
}

export function renderWhoAreYou(current) {
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

export function renderGames() {
  const live = scoreboardGames('in');
  const final = scoreboardGames('post');
  // One spinner until both the lines and the scores are in, so the board shows up whole.
  const linesLoading = !state.games.length && !state.lobby && !state.gamesError;
  const scoresLoading = !state.sports && !state.sportsFailed;
  if (linesLoading || scoresLoading) return `<div class="loading-block" data-key="lines-note"><div class="spinner"></div><p class="muted">Loading this week’s games…</p></div>`;
  // Where the lines stand, above any games that have kicked off. A failed refresh keeps
  // the last lines on screen; only a first load shows the error.
  const linesNote = state.games.length ? ''
    : state.gamesError ? `<div class="card" data-key="lines-note"><p class="error">Couldn’t load lines: ${esc(state.gamesError)}</p><button class="btn" data-action="reload-lines">Retry</button></div>`
      : live.length + final.length ? '' : `<div class="card" data-key="lines-note"><p>No NFL games found for this week yet.</p></div>`;

  // Games still to come by day, then a band and the live games, then the final ones.
  const upcoming = state.games.filter((g) => !hasStarted(g));
  const band = (label, games, cls = '') => `<div class="band ${cls}" data-key="band-${label}"><span>${label}</span><small>${games.length} ${games.length === 1 ? 'game' : 'games'}</small></div>`;
  return linesNote + byDay(upcoming, renderGame, '')
    + (live.length ? band('LIVE', live, 'live') + byDay(live, liveCard, 'live-') : '')
    + (final.length ? band('FINAL', final) + byDay(final, finalCard, 'final-') : '');
}

// Games grouped under their day's title. Upcoming days get ids for the day chips.
function byDay(games, render, prefix) {
  const days = new Map();
  for (const g of games) {
    const day = dayFmt.format(g.start);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(g);
  }
  return [...days].map(([day, list]) => `
    <section class="day" ${prefix ? `data-key="${prefix}${dayId(list[0].start)}"` : `id="${dayId(list[0].start)}"`}>
      <h2 class="day-title">${esc(day)}</h2>
      ${list.map(render).join('')}
    </section>`).join('');
}

// Kickoff time (the day is already in the section header), then TV and weather.
function gameMeta(game) {
  const info = state.sports?.games.get(gameKey(game.away, game.home));
  return `<span class="meta-time">${esc(timeFmt.format(game.start))}</span>${info ? gameExtras(info) : ''}`
    + `<button class="meta-research" data-action="matchup" data-id="${esc(game.id)}">Matchup ${chevronSmall()}</button>`;
}

// A scoreboard game's TV, then (unless it's over) its weather or dome.
function gameExtras(info, weather = true) {
  let html = info.tv ? `<span class="tv-list">${tvBadges(info.tv)}</span>` : '';
  if (!weather) return html;
  if (info.dome) html += '<span class="wx">🏟️<span>Dome</span></span>';
  else if (info.weather) html += `<span class="wx" title="${esc(info.weather.text)}">${weatherIcon(info.weather.text)}<span>${esc(info.weather.temp)}°</span></span>`;
  return html;
}

function formDots(team) {
  if (!team?.lastFive.length) return '';
  // Oldest on the left, most recent on the right.
  return `<span class="dots">${team.lastFive.map((g) => `<i class="${g.result.toLowerCase()}"></i>`).join('')}</span>`;
}

// Sportsbook grid: two team rows x (Money | Spread | Total), with a line strip
// between the team rows. Taken picks show the picker's avatar in place; once someone
// holds a game + bet type, the rest of that column is disabled.
function renderGame(game) {
  const takers = gameTakers(game);
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
    { type: 'ml', has: game.ml.some(Boolean) },
    { type: 'spread', has: !!game.spread?.rungs.length },
    { type: 'total', has: !!game.total?.rungs.length },
  ].map((c, i) => ({ ...c, col: i + 3 }));

  // Column 1 is the win-chance bar, column 2 the teams, then Money, Spread, Total.
  let html = HEADS;
  // Rows: 2 = away team, 3 = line strips, 4 = home team.
  html += winBar(game.away, game.home, awayWinPct(game)) + teamCell(game.away, 2) + teamCell(game.home, 4);
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
    // A column nobody here can pick from fades its strip as much as its cells.
    const open = (opt) => opt && (picks()[state.me]?.optKey === opt.key || !pickProblem(opt));
    html += strip(game, c.type, key, index, `3/${c.col}`, !isLocked() && !open(top) && !open(bottom));
  }

  return `
  <article class="game ${takers.some((t) => t.mine) ? 'has-mine' : ''} ${beforeCutoff(game) ? 'before-cutoff' : ''}" data-key="${esc(game.id)}">
    <div class="g-meta">${gameMeta(game)}</div>
    <div class="g-grid">${html}</div>
    ${beforeCutoff(game) ? '<p class="g-note">🔒 Kicks off before picks lock</p>' : ''}
  </article>`;
}

const HEADS = ['Money', 'Spread', 'Total'].map((label, i) => `<div class="g-head" style="grid-area:1/${i + 3}">${label}</div>`).join('');

// A vertical bar beside the team rows: the top part is the away team's win chance, the
// bottom part the home team's, so each share sits next to the team it belongs to. A
// finished game's bar is all the winner's color.
function winBar(away, home, awayPct) {
  if (awayPct == null) return '';
  const colors = matchupColors(away, home);
  return `
    <div class="win-bar" style="grid-area:2/1/5/2" title="${esc(away)} ${awayPct}% · ${esc(home)} ${100 - awayPct}%">
      ${awayPct > 0 ? `<span style="flex-basis:${awayPct}%;background:${colors.away}"></span>` : ''}
      ${awayPct < 100 ? `<span style="flex-basis:${100 - awayPct}%;background:${colors.home}"></span>` : ''}
    </div>`;
}

// ---------- games that have kicked off ----------

// A started game's team row: the abbreviation under the logo (where the record sits),
// the score beside it, and while live, timeouts left under the score.
const scoredTeam = (abbr, row, score, { lost = false, timeouts = null } = {}) => `
  <button class="g-team scored ${lost ? 'lost' : ''}" style="grid-area:${row}/2" data-action="team" data-id="${esc(abbr)}">
    ${teamLogo(abbr, 24)}
    <span class="g-score">${score}</span>
    <small class="g-abbr-s">${esc(abbr)}</small>
    ${timeouts == null ? '' : `<span class="tos" title="${timeouts} timeouts left">${[0, 1, 2].map((i) => `<i class="${i < timeouts ? '' : 'used'}"></i>`).join('')}</span>`}
  </button>`;

// A cell on a started game: not tappable; once final, a ✓ if it won and faded if not.
// Stickers stay on, so you can see who had what.
const frozen = (area, main, sub, cls, stickers) => `
  <div class="cell frozen ${cls}" style="grid-area:${area}">
    <span class="cell-main">${signSpan(main)}</span>${sub ? `<span class="cell-sub">${signSpan(sub)}</span>` : ''}${stickers}
  </div>`;

// The spread or total line a started game shows: the one someone here picked (yours
// first), else the one closest to even.
function shownLine(list, takers, even) {
  for (const t of [...takers].sort((a, b) => b.mine - a.mine)) {
    const hit = list.find((r) => t.pick.optKey.startsWith(`${r.id}:`));
    if (hit) return hit;
  }
  return [...list].sort((a, b) => Math.abs(even(a) - 50) - Math.abs(even(b) - 50))[0] ?? null;
}

// The six cells of a started game from its lines (live, or at kickoff), with ✓s once
// it's final (`result`: the final score).
function startedCells(g, lines, takers, result) {
  if (!lines) return [2, 4].flatMap((row) => [3, 4, 5].map((col) => `<span class="cell cell-empty" style="grid-area:${row}/${col}">—</span>`)).join('');
  const stick = (test) => takers.filter((t) => test(t.pick)).map((t) => sticker(t.member, t.pick.optKey)).join('');
  const mark = (won) => (!result ? '' : won === null ? 'push' : won ? 'won' : 'lost');
  const margin = result && result.away - result.home; // away's
  const sp = shownLine(lines.spreads, takers.filter((t) => t.pick.type === 'spread'), (r) => r.away);
  const to = shownLine(lines.totals, takers.filter((t) => t.pick.type === 'total'), (r) => r.over);
  const spreadWon = sp && result && (margin + sp.awayLine === 0 ? null : margin + sp.awayLine > 0);
  const overWon = to && result && (result.away + result.home === to.line ? null : result.away + result.home > to.line);
  const onSpread = (side) => (p) => sp && p.optKey.startsWith(`${sp.id}:`) && p.team === side;
  const onTotal = (side) => (p) => to && p.optKey.startsWith(`${to.id}:`) && p.side === side;
  const ml = (side, row) => (lines.ml[side] == null ? `<span class="cell cell-empty" style="grid-area:${row}/3">—</span>`
    : frozen(`${row}/3`, fmtOdds(lines.ml[side]), '', `cell-ml ${mark(result && (side === 'away' ? margin > 0 : margin < 0))}`, stick((p) => p.type === 'ml' && p.team === g[side])));
  return ml('away', 2) + ml('home', 4)
    + (sp ? frozen('2/4', fmtLine(sp.awayLine), fmtOdds(sp.away), mark(spreadWon), stick(onSpread(g.away)))
      + frozen('4/4', fmtLine(-sp.awayLine), fmtOdds(sp.home), mark(spreadWon === null ? null : spreadWon === false), stick(onSpread(g.home)))
      : '<span class="cell cell-empty" style="grid-area:2/4">—</span><span class="cell cell-empty" style="grid-area:4/4">—</span>')
    + (to ? frozen('2/5', `O ${to.line}`, fmtOdds(to.over), mark(overWon), stick(onTotal('over')))
      + frozen('4/5', `U ${to.line}`, fmtOdds(to.under), mark(overWon === null ? null : overWon === false), stick(onTotal('under')))
      : '<span class="cell cell-empty" style="grid-area:2/5">—</span><span class="cell cell-empty" style="grid-area:4/5">—</span>');
}

// Who here picked a started game (matched by teams, since a finished game is gone
// from the lobby's list).
const startedTakers = (g) => Object.entries(picks())
  .filter(([, p]) => p.matchup === `${g.away} @ ${g.home}`)
  .map(([uid, p]) => ({ member: memberById(uid), pick: p, mine: uid === state.me }))
  .filter((t) => t.member);

// The game's research page, if it's still on the board.
const matchupLink = (g) => {
  const lobby = state.games.find((x) => x.away === g.away && x.home === g.home);
  return lobby ? `<button class="meta-research" data-action="matchup" data-id="${esc(lobby.id)}">Matchup ${chevronSmall()}</button>` : '';
};

// Live: the clock where the kickoff time was, scores and timeouts by the teams, the
// down and the spot between them (the arrow points at the team with the ball), and the
// market's live prices.
function liveCard(g) {
  const st = g.status;
  const lines = state.prices.get(g.key);
  const takers = startedTakers(g);
  const { ml } = lines ?? { ml: {} };
  const awayPct = ml.away && ml.home ? Math.round((100 * ml.away) / (ml.away + ml.home)) : null;
  const ballTop = st.possession === g.away;
  const drive = st.possession && st.downDistance
    ? `<div class="drive ${st.redZone ? 'redzone' : ''}" style="grid-area:3/2/4/6"><span class="arrow">${ballTop ? '▲' : '▼'}</span>${esc(st.downDistance)}${st.spot ? ` · ${esc(st.spot)}` : ''}</div>`
    : '';
  return `
  <article class="game live ${takers.some((t) => t.mine) ? 'has-mine' : ''}" data-key="${esc(g.key)}">
    <div class="g-meta"><span class="live-clock">${esc(st.detail || 'Starting')}</span>${gameExtras(g)}${matchupLink(g)}</div>
    <div class="g-grid">${HEADS}${winBar(g.away, g.home, awayPct)}
      ${scoredTeam(g.away, 2, st.awayScore, { timeouts: st.timeouts?.[0] })}${scoredTeam(g.home, 4, st.homeScore, { timeouts: st.timeouts?.[1] })}
      ${drive}${startedCells(g, lines, takers, null)}</div>
  </article>`;
}

// Final: the kickoff time, the winner's color in the bar, each line's price at kickoff
// with a ✓ on what won, and between the teams the win chance through the game, the
// final margin ("JAX by 8"), and the total points.
function finalCard(g) {
  const st = g.status;
  const lines = state.prices.get(g.key);
  const takers = startedTakers(g);
  const margin = st.awayScore - st.homeScore;
  const winner = margin > 0 ? g.away : margin < 0 ? g.home : null;
  const middle = `
    ${lines?.momentum ? momentum(lines.momentum, matchupColors(g.away, g.home)) : ''}
    <div class="settle" style="grid-area:3/4">${winner ? `${esc(winner)} by ${Math.abs(margin)}` : 'Tie'}</div>
    <div class="settle" style="grid-area:3/5">${st.awayScore + st.homeScore}</div>`;
  return `
  <article class="game final ${takers.some((t) => t.mine) ? 'has-mine' : ''}" data-key="${esc(g.key)}">
    <div class="g-meta"><span class="meta-time">${esc(dayTimeFmt.format(g.start))}</span>${gameExtras(g, false)}${matchupLink(g)}</div>
    <div class="g-grid">${HEADS}${winBar(g.away, g.home, winner === g.away ? 100 : winner === g.home ? 0 : 50)}
      ${scoredTeam(g.away, 2, st.awayScore, { lost: winner === g.home })}${scoredTeam(g.home, 4, st.homeScore, { lost: winner === g.away })}
      ${middle}${startedCells(g, lines, takers, { away: st.awayScore, home: st.homeScore })}</div>
  </article>`;
}

// The away team's win chance through a finished game, as a small line in the Money
// column: above the middle in the away team's color, below it in the home team's.
let chartId = 0;
function momentum(series, colors) {
  const id = `wc${chartId++}`;
  const pts = series.map((p, i) => `${((i / (series.length - 1)) * 100).toFixed(1)},${(24 - (p / 100) * 24).toFixed(1)}`).join(' ');
  const half = (clip, color) => `
    <polygon points="0,12 ${pts} 100,12" fill="${color}" fill-opacity="0.5" clip-path="url(#${id}${clip})"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke" clip-path="url(#${id}${clip})"/>`;
  return `<svg class="momentum" style="grid-area:3/3" viewBox="0 0 100 24" preserveAspectRatio="none" aria-label="Win chance through the game">
    <defs><clipPath id="${id}a"><rect width="100" height="12"/></clipPath><clipPath id="${id}h"><rect y="12" width="100" height="12"/></clipPath></defs>
    <line x1="0" y1="12" x2="100" y2="12" stroke="#2d3963" stroke-width="1" vector-effect="non-scaling-stroke"/>
    ${half('a', colors.away)}${half('h', colors.home)}
  </svg>`;
}

// Horizontal strip of every line, between the two team rows, with a tick under each
// (styles.css). Scroll it and the buttons above and below follow. Spread values read
// from the away (top) team's side; their sign hangs off the left, so the tick sits under
// the number itself.
function strip(game, type, key, index, area, dim) {
  const ladder = game[type];
  const label = (r) => (type === 'spread' ? fmtLine(r.away.line).replace(/^([+−])(.*)$/, '<span class="num"><span class="sg">$1</span>$2</span>') : r.line);
  return `
    <div class="strip ${dim ? 'dim' : ''}" data-ladder="${esc(key)}" data-key="${esc(key)}" style="grid-area:${area}">
      ${ladder.rungs.map((r, i) => `<div class="strip-item ${i === index ? 'on' : ''}">${label(r)}</div>`).join('')}
    </div>`;
}

export function cell(opt, type, area, cellId) {
  const style = `style="grid-area:${area}"${cellId ? ` data-cell="${esc(cellId)}"` : ''}`;
  if (!opt) return `<span class="cell cell-empty" ${style}>—</span>`;
  const holderId = Object.entries(picks()).find(([, p]) => p.optKey === opt.key)?.[0];
  const mine = holderId && holderId === state.me;
  const holder = holderId && !mine ? memberById(holderId) : null;
  // Once picks lock, the board is for looking: full color, nothing tappable, no hover.
  // (The admin, picking for someone, can still change it.)
  const frozen = isLocked() && !state.acting;
  const blocked = !frozen && !mine && !holder && clashFor(state.slip, state.me, opt);
  const disabled = !frozen && !mine && !!pickProblem(opt);
  const main = signSpan(type === 'ml' ? fmtOdds(opt.price) : type === 'spread' ? fmtLine(opt.line) : `${opt.side === 'over' ? 'O' : 'U'} ${opt.line}`);
  const cls = ['cell', type === 'ml' && 'cell-ml', mine && 'mine', mine && state.justPicked === opt.key && 'just-picked', holder && 'taken', blocked && 'blocked', frozen && 'frozen'].filter(Boolean).join(' ');
  return `
    <button class="${cls}" ${style} ${frozen ? 'tabindex="-1"' : 'data-action="choose"'} data-key="${esc(opt.key)}" ${disabled ? 'aria-disabled="true"' : ''}>
      <span class="cell-main">${main}</span>
      ${cellSub(type, opt)}
      ${holder || mine ? sticker(holder ?? memberById(state.me), opt.key) : ''}
    </button>`;
}

// Every pick gets the picker's avatar stuck on like a sticker, yours included: same spot
// and tilt every render (seeded from who and what), but a little different on every
// cell, so it looks placed by hand. New ones get slapped on with a bounce.
function sticker(member, key) {
  const id = `${member.id}:${key}`;
  const rand = seeded(id);
  // A pick that just appeared slaps its sticker on, keeping the class for the length of
  // the slap so a redraw mid-slap doesn't cut it short (app.js trackPicks).
  const fresh = Date.now() - (state.pickSince.get(id) ?? 0) < STICKER_SLAP_MS;
  // Tilt 7–18° either way: never so straight it looks placed by a machine.
  const tilt = (rand() < 0.5 ? -1 : 1) * Math.round(7 + rand() * 11);
  const vars = `--rot:${tilt}deg;--dx:${Math.round(-6 + rand() * 6)}px;--dy:${Math.round(-6 + rand() * 7)}px`;
  return `<span class="sticker ${fresh ? 'slap' : ''}" style="${vars}" data-sticker="${esc(id)}" title="${esc(member.name)} has this">${avatar(member, 19)}</span>`;
}

// Second line of a cell: the odds (moneyline cells show odds as their main number).
function cellSub(type, opt) {
  return type === 'ml' ? '' : `<span class="cell-sub">${signSpan(fmtOdds(opt.price))}</span>`;
}
