// The board: top bar, day chips, deadline countdown, and the game cards with their
// pickable cells. Also the "Who's picking?" screen.
import { matchupColors } from '../teams.js';
import { clashFor, gameKey } from '../rules.js';
import { awayWinPct, beforeCutoff, gameTakers, isLocked, ladderKey, ladderSides, memberById, myLegLocked, picks, rungIndex, state } from '../state.js';
import { LOCK_ICON, avatar, chevronSmall, dayFmt, esc, fmtLine, fmtOdds, pretty, seeded, shortDayFmt, signSpan, teamLogo, timeFmt, tvBadges, weatherIcon } from '../ui.js';

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
        <small>Week ${esc(slip.week)} · ${legCount} ${legCount === 1 ? 'leg' : 'legs'}${isLocked() ? ' · 🔒 Locked' : ''}</small>
      </div>
    </div>
    ${me && !state.acting ? `
      <button class="me-chip" data-action="switch-user" aria-label="Signed in as ${esc(me.name)}. Not you?">
        <span class="me-text"><strong>${esc(me.name)}</strong><small>not you?</small></span>
        ${avatar(me, 34)}
      </button>` : ''}
  </header>`;
}

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
  const upcoming = state.games.filter((g) => !g.locked);
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
  const sections = [...byDay].map(([day, games]) => `
    <section class="day" id="${dayId(games[0].start)}">
      <h2 class="day-title">${esc(day)}</h2>
      ${games.map(renderGame).join('')}
    </section>`).join('');

  const startedSection = started.length ? `
    <section class="day started" data-key="started">
      <button class="day-title started-toggle" data-action="toggle-started">
        Started · ${started.length} ${started.length === 1 ? 'game' : 'games'} <span>${state.showStarted ? '▴' : '▾'}</span>
      </button>
      ${state.showStarted ? started.map(renderGame).join('') : ''}
    </section>` : '';
  return sections + startedSection;
}

// Kickoff time (the day is already in the section header), then TV and weather.
function gameMeta(game, { research = true } = {}) {
  const info = state.sports?.games.get(gameKey(game.away, game.home));
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
  return `<span class="dots">${team.lastFive.map((g) => `<i class="${g.result.toLowerCase()}"></i>`).join('')}</span>`;
}

// Sportsbook grid: two team rows x (Money | Spread | Total), with a line strip
// between the team rows. Taken picks show the picker's avatar in place; once someone
// holds a game + bet type, the rest of that column is disabled.
function renderGame(game) {
  const takers = gameTakers(game);
  if (game.locked) {
    const st = state.sports?.games.get(gameKey(game.away, game.home))?.status;
    const scored = st && st.state !== 'pre';
    return `
    <article class="game locked ${st?.state === 'in' ? 'is-live' : ''}" data-key="${esc(game.id)}">
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
  <article class="game ${takers.some((t) => t.mine) ? 'has-mine' : ''} ${beforeCutoff(game) ? 'before-cutoff' : ''}" data-key="${esc(game.id)}">
    <div class="g-meta">${gameMeta(game)}</div>
    <div class="g-grid">${html}</div>
    ${beforeCutoff(game) ? '<p class="g-note">🔒 Kicks off before picks lock</p>' : ''}
  </article>`;
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
export function strip(game, type, key, index, area) {
  const ladder = game[type];
  return `
    <div class="strip" data-ladder="${esc(key)}" style="grid-area:${area}">
      ${ladder.rungs.map((r, i) => {
        const cls = ['strip-item', i === index && 'on'].filter(Boolean).join(' ');
        return `<div class="${cls}">${type === 'spread' ? fmtLine(r.away.line) : r.line}</div>`;
      }).join('')}
    </div>`;
}

export function cell(opt, type, area, cellId) {
  const style = `style="grid-area:${area}"${cellId ? ` data-cell="${esc(cellId)}"` : ''}`;
  if (!opt) return `<span class="cell cell-empty" ${style}>—</span>`;
  const holderId = Object.entries(picks()).find(([, p]) => p.optKey === opt.key)?.[0];
  const mine = holderId && holderId === state.me;
  const holder = holderId && !mine ? memberById(holderId) : null;
  const blocked = !mine && !holder && clashFor(state.slip, state.me, opt);
  const game = state.games.find((g) => g.id === opt.gameId);
  const closed = !game || beforeCutoff(game) || game.start <= Date.now();
  const disabled = !mine && (!!holder || !!blocked || !opt.available || closed || myLegLocked());
  const main = signSpan(type === 'ml' ? fmtOdds(opt.price) : type === 'spread' ? fmtLine(opt.line) : `${opt.key.endsWith(':yes') ? 'O' : 'U'} ${opt.line}`);
  const cls = ['cell', type === 'ml' && 'cell-ml', mine && 'mine', mine && state.justPicked === opt.key && 'just-picked', holder && 'taken', blocked && 'blocked', state.busyKey === opt.key && 'busy'].filter(Boolean).join(' ');
  return `
    <button class="${cls}" ${style} data-action="choose" data-key="${esc(opt.key)}" ${disabled ? 'aria-disabled="true"' : ''}>
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
  // New stickers slap on, and keep the class for the length of the slap (0.5s) so a
  // redraw mid-slap doesn't cut it short.
  if (!state.seenStickers.has(id)) state.seenStickers.set(id, state.stickersPrimed ? Date.now() : 0);
  const fresh = Date.now() - state.seenStickers.get(id) < 500;
  // Tilt 7–18° either way: never so straight it looks placed by a machine.
  const tilt = (rand() < 0.5 ? -1 : 1) * Math.round(7 + rand() * 11);
  const vars = `--rot:${tilt}deg;--dx:${Math.round(-6 + rand() * 6)}px;--dy:${Math.round(-6 + rand() * 7)}px`;
  return `<span class="sticker ${fresh ? 'slap' : ''}" style="${vars}" title="${esc(member.name)} has this">${avatar(member, 19)}</span>`;
}

// Second line of a cell: the odds (moneyline cells show odds as their main number).
function cellSub(type, opt) {
  return type === 'ml' ? '' : `<span class="cell-sub">${signSpan(fmtOdds(opt.price))}</span>`;
}
