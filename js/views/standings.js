// The season's standings (a research-style page): the leaderboard, how each week's slip
// did, and the standout legs. Tapping a name opens that member's page: their record and
// how close every leg came. The numbers come from history.js.
import { CLOSE, highlights, standings, weekResults } from '../history.js';
import { state } from '../state.js';
import { avatar, chevronSmall, esc, fmtSigned, toneOf } from '../ui.js';

const loading = () => {
  const s = state.standings;
  if (s?.error) return `<p class="muted center-note">Couldn’t load the standings: ${esc(s.error)}</p>`;
  return '<div class="loading-block small"><div class="spinner"></div><p class="muted">Adding up the season…</p></div>';
};

const member = (id) => state.standings.members.get(id) ?? { id, name: 'Someone' };
const record = (r) => `${r.hits}–${r.misses}${r.pushes ? `–${r.pushes}` : ''}`;
const pct = (r) => (r.pct == null ? '—' : `${Math.round(r.pct * 100)}%`);
const margin = (n) => (n == null ? '—' : fmtSigned(Math.round(n * 10) / 10));
const dot = (l) => `<i class="${l.grade}" title="Week ${l.week}: ${esc(l.pick.label)}"></i>`;
// "by 3.5", the way a leg landed.
const landed = (l) => (l.grade === 'push' ? 'Push' : `${l.grade === 'hit' ? 'Hit' : 'Missed'} by ${Math.abs(l.margin)}`);

export const standingsTitle = () => '<span class="ts-side"><b>Standings</b></span>';
export const playerTitle = (id) => (state.standings?.members ? `<span class="ts-side">${avatar(member(id), 20)}<b>${esc(member(id).name)}</b></span>` : '');

export function renderStandingsPage() {
  const s = state.standings;
  if (!s?.legs) return loading();
  const rows = standings(s.legs);
  const weeks = weekResults(s.slips, s.legs);
  const played = weeks.filter((w) => w.total);
  const done = played.filter((w) => !w.pending);
  const cashed = done.filter((w) => w.cashed).length;
  const span = played.length ? `Week${played.length > 1 ? 's' : ''} ${[played.at(-1).week, played[0].week].filter((w, i, a) => a.indexOf(w) === i).join('–')}` : 'No weeks yet';

  const hero = `
    <div class="st-hero">
      <span class="st-cup">🏆</span>
      <h2>Standings</h2>
      <p>${span} · ${s.legs.length} ${s.legs.length === 1 ? 'leg' : 'legs'} graded ${done.length ? ` · ${cashed} of ${done.length} ${done.length === 1 ? 'slip' : 'slips'} cashed` : ''}</p>
    </div>`;
  if (!rows.length) return `${hero}<p class="muted center-note">No finished legs yet. Check back after this week’s games.</p>`;

  const board = `
    <div class="cmp st-card">
      <div class="st-head"><span>Leaderboard</span><small>Record · hit rate</small></div>
      ${rows.map((r) => `
        <button class="st-row ${r.memberId === state.me ? 'me' : ''}" data-action="player" data-id="${esc(r.memberId)}">
          <span class="st-rank ${r.rank === 1 ? 'top' : ''}">${r.rank}</span>
          ${avatar(member(r.memberId), 30)}
          <span class="st-name"><b>${esc(member(r.memberId).name)}</b><span class="st-dots">${r.legs.map(dot).join('')}</span></span>
          <span class="st-rec"><b>${record(r)}</b><small>${pct(r)}</small></span>
          <span class="st-go">${chevronSmall()}</span>
        </button>`).join('')}
    </div>`;

  const weekRows = `
    <div class="cmp st-card">
      <div class="st-head"><span>Each week’s slip</span><small>Tap to open</small></div>
      ${played.map((w) => `
        <button class="st-week" data-action="week-go" data-id="${w.week}">
          <b>Week ${w.week}</b>
          <span class="st-week-tally">${w.hits || w.misses ? `<span class="t-hit">✓ ${w.hits}</span>` : ''}${w.misses ? `<span class="t-miss">✗ ${w.misses}</span>` : ''}${w.pending ? `<span class="muted">${w.pending} to play</span>` : ''}</span>
          <span class="st-week-result ${w.cashed ? 'cashed' : w.misses ? 'busted' : ''}">${w.cashed ? 'Cashed' : w.misses ? 'Busted' : w.pending === w.total ? 'Upcoming' : 'Live'}</span>
          <span class="st-go">${chevronSmall()}</span>
        </button>`).join('')}
    </div>`;

  const h = highlights(s.legs);
  const tile = (label, l, value) => (l ? `
    <button class="st-tile" data-action="player" data-id="${esc(l.memberId)}">
      <small>${label}</small>
      <b class="${l.grade}">${value}</b>
      <span class="st-tile-who">${avatar(member(l.memberId), 18)}${esc(member(l.memberId).name)}</span>
      <span class="st-tile-pick">${esc(l.pick.label)} · Wk ${l.week}</span>
    </button>` : '');
  const chance = (l) => Math.round(100 * (l.pick.fair ?? l.pick.price / 100));
  const tiles = [
    tile('Biggest cover', h.biggest, h.biggest && margin(h.biggest.margin)),
    tile('Closest hit', h.closest, h.closest && margin(h.closest.margin)),
    tile('Heartbreaker', h.heartbreak, h.heartbreak && margin(h.heartbreak.margin)),
    tile('Longest shot', h.longshot, h.longshot && `${chance(h.longshot)}%`),
  ].join('');

  return `${hero}${board}${tiles ? `<div class="st-tiles">${tiles}</div>` : ''}${weekRows}`;
}

export function renderPlayerPage(id) {
  const s = state.standings;
  if (!s?.legs) return loading();
  const rows = standings(s.legs);
  const r = rows.find((row) => row.memberId === id);
  const m = member(id);
  if (!r) return `<div class="st-hero">${avatar(m, 64)}<h2>${esc(m.name)}</h2><p>No finished legs yet.</p></div>`;

  // How likely their legs were when picked, on average (the no-vig market chance).
  const avgChance = r.legs.reduce((sum, l) => sum + (l.pick.fair ?? l.pick.price / 100), 0) / r.legs.length;
  const best = Math.max(...r.legs.map((l) => l.margin));
  const stat = (label, value, cls = '') => `<div class="info-cell ${cls}"><b>${value}</b><small>${label}</small></div>`;
  const byType = ['ml', 'spread', 'total'].map((type) => {
    const legs = r.legs.filter((l) => l.pick.type === type);
    const hits = legs.filter((l) => l.grade === 'hit').length;
    return stat({ ml: 'Moneyline', spread: 'Spread', total: 'Total' }[type], legs.length ? `${hits}–${legs.length - hits}` : '—');
  }).join('');

  // How close each leg came: a bar out from the middle, right for a hit, left for a
  // miss, as long as the margin (two touchdowns or more fills it).
  const FULL = 14;
  const legRows = [...r.legs].reverse().map((l) => {
    const width = Math.min(1, Math.abs(l.margin) / FULL) * 50;
    const close = Math.abs(l.margin) <= CLOSE && l.grade !== 'push';
    return `
      <div class="pl-leg">
        <div class="pl-leg-top">
          <span class="pl-week">Wk ${l.week}</span>
          <b>${esc(l.pick.label)}</b>
          <span class="pl-landed ${l.grade}">${landed(l)}${close ? ' <em>close</em>' : ''}</span>
        </div>
        <div class="pl-bar"><i class="${l.grade}" style="${l.margin >= 0 ? 'left:50%' : `right:50%`};width:${width}%"></i></div>
        <small class="pl-score">${esc(l.away)} ${l.awayScore} – ${esc(l.home)} ${l.homeScore}</small>
      </div>`;
  }).join('');

  return `
    <div class="st-hero">
      ${avatar(m, 64)}
      <h2>${esc(m.name)}</h2>
      <p>${r.rank === 1 ? '🏆 ' : ''}${ordinal(r.rank)} of ${rows.length}</p>
    </div>
    <div class="info-grid">
      ${stat('Record', record(r))}
      ${stat('Hit rate', pct(r))}
      ${stat('Avg margin', margin(r.avgMargin), toneOf(r.avgMargin))}
      ${byType}
      ${stat('Avg chance', `${Math.round(100 * avgChance)}%`)}
      ${stat(`Within ${CLOSE} pts`, r.close)}
      ${stat('Best leg', margin(best), toneOf(best))}
    </div>
    <div class="cmp st-card">
      <div class="st-head"><span>How close</span><small>Newest first</small></div>
      <div class="pl-axis"><span class="t-miss">← Missed by</span><span class="t-hit">Hit by →</span></div>
      ${legRows}
    </div>`;
}

function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}
