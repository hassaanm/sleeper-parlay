// The season's standings (a research-style page), in two tabs: the leaderboard, and the
// history of each week's slip. A name opens that member's page (their record and how
// close every leg came); a week opens that week's page (its standout legs as stickers,
// then the slip itself). The numbers come from history.js.
import { CLOSE, highlights, standings, weekResults } from '../history.js';
import { gameKey, gradePick } from '../rules.js';
import { state } from '../state.js';
import { renderWeekTicket } from './slip.js';
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
  const weeks = weekResults(s.slips, s.legs).filter((w) => w.total);
  const done = weeks.filter((w) => !w.pending);
  const cashed = done.filter((w) => w.cashed).length;
  const span = weeks.length ? `Week${weeks.length > 1 ? 's' : ''} ${[weeks.at(-1).week, weeks[0].week].filter((w, i, a) => a.indexOf(w) === i).join('–')}` : 'No weeks yet';
  const tab = state.standingsTab;

  const hero = `
    <div class="st-hero">
      <span class="st-cup">🏆</span>
      <h2>Standings</h2>
      <p>${span}${done.length ? ` · ${cashed} of ${done.length} ${done.length === 1 ? 'slip' : 'slips'} cashed` : ''}</p>
    </div>
    <div class="st-tabs" role="tablist">
      ${[['board', 'Leaderboard'], ['history', 'History']].map(([id, label]) => `
        <button role="tab" aria-selected="${tab === id}" class="${tab === id ? 'on' : ''}" data-action="standings-tab" data-id="${id}">${label}</button>`).join('')}
    </div>`;

  if (tab === 'history') {
    return `${hero}
    <div class="cmp st-card">
      ${weeks.map((w) => `
        <button class="st-week ${resultOf(w).cls}" data-action="${w.hits + w.misses ? 'week-page' : 'week-go'}" data-id="${w.week}">
          <span class="st-week-num"><small>Week</small><b>${w.week}</b></span>
          <span class="st-week-mid">
            <span class="st-week-tally">${w.hits || w.misses ? `<span class="t-hit">✓ ${w.hits}</span><span class="t-miss">✗ ${w.misses}</span>` : ''}${w.pending ? `<span class="muted">${w.pending} to play</span>` : ''}<small>${payout(slipOf(w.week)).toLocaleString()}× slip</small></span>
            <span class="st-week-bar">${weekBar(w.week)}</span>
          </span>
          <span class="st-week-result ${resultOf(w).cls}">${resultOf(w).label}</span>
          <span class="st-go">${chevronSmall()}</span>
        </button>`).join('') || '<p class="muted center-note">No weeks yet.</p>'}
    </div>`;
  }

  if (!rows.length) return `${hero}<p class="muted center-note">No finished legs yet. Check back after this week’s games.</p>`;
  // The top three stand on a podium (when there are at least three); everyone, the top
  // three included, is in the list under it.
  const podium = rows.length >= 3 ? `
    <div class="podium">
      ${[[rows[1], 'silver'], [rows[0], 'gold'], [rows[2], 'bronze']].map(([r, medal]) => `
        <button class="pod ${medal}" data-action="player" data-id="${esc(r.memberId)}">
          <span class="pod-face">${avatar(member(r.memberId), medal === 'gold' ? 56 : 46)}${medal === 'gold' ? '<i class="pod-crown">👑</i>' : ''}</span>
          <b class="pod-name">${esc(member(r.memberId).name)}</b>
          <span class="pod-score ${toneOf(r.score)}">${score(r.score)}</span>
          <span class="pod-step"><i>${r.rank}</i><small>${record(r)}</small></span>
        </button>`).join('')}
    </div>` : '';
  return `${hero}${podium}
    <div class="cmp st-card">
      <div class="st-head"><span>Beat the odds</span><small>Hits minus expected hits</small></div>
      ${rows.map((r) => `
        <button class="st-row ${r.memberId === state.me ? 'me' : ''}" data-action="player" data-id="${esc(r.memberId)}">
          <span class="st-rank r${r.rank}">${r.rank}</span>
          ${avatar(member(r.memberId), 32)}
          <span class="st-name"><b>${esc(member(r.memberId).name)}</b><span class="st-dots">${r.legs.map(dot).join('')}</span></span>
          <span class="st-rec"><b class="st-score ${toneOf(r.score)}">${score(r.score)}</b><small>${record(r)} · ${Math.round(100 * r.avgChance)}% · ${margin(r.avgMargin)}</small></span>
        </button>`).join('')}
      <p class="st-key">Score: hits minus the hits your picks’ odds expected. Then record · average chance · average margin.</p>
    </div>`;
}

// "+2.2", "−3.5", "0.0": how far someone beat (or trailed) the odds.
const score = (n) => (n > 0 ? `+${n.toFixed(1)}` : n < 0 ? `−${Math.abs(n).toFixed(1)}` : '0.0');

// A week's legs as squares, in kickoff order: green hit, red miss, gray still to play.
function weekBar(week) {
  const games = state.standings.boards.get(week) ?? new Map();
  return Object.values(slipOf(week)?.picks ?? {}).sort((a, b) => a.start - b.start).map((pick) => {
    const st = games.get(gameKey(...pick.matchup.split(' @ ')))?.status;
    const grade = st?.state === 'post' ? gradePick(pick, st.awayScore, st.homeScore) : 'later';
    return `<i class="${grade}"></i>`;
  }).join('');
}

const slipOf = (week) => state.standings.slips.find((slip) => Number(slip.week) === week);
// What the whole slip would pay, as a multiple: every leg's price multiplied together.
const payout = (slip) => Math.round(Object.values(slip?.picks ?? {}).reduce((x, p) => x * (100 / p.price), 1));
const resultOf = (w) => (w.cashed ? { label: 'Cashed', cls: 'cashed' } : w.misses ? { label: 'Busted', cls: 'busted' }
  : { label: w.pending === w.total ? 'Upcoming' : 'Live', cls: '' });

// One leg on a member's page and how close it came: a bar out from the middle, right
// for a hit, left for a miss, as long as the margin (two touchdowns or more fills it).
function legRow(l) {
  const width = Math.min(1, Math.abs(l.margin) / 14) * 50;
  const close = Math.abs(l.margin) <= CLOSE && l.grade !== 'push';
  return `
    <div class="pl-leg">
      <div class="pl-leg-top">
        <span class="pl-week">Wk ${l.week}</span>
        <b>${esc(l.pick.label)}</b>
        <span class="pl-landed ${l.grade}">${landed(l)}${close ? ' <em>close</em>' : ''}</span>
      </div>
      <div class="pl-bar"><i class="${l.grade}" style="${l.margin >= 0 ? 'left:50%' : 'right:50%'};width:${width}%"></i></div>
      <small class="pl-score">${esc(l.away)} ${l.awayScore} – ${esc(l.home)} ${l.homeScore}</small>
    </div>`;
}

const axis = '<div class="pl-axis"><span class="t-miss">← Missed by</span><span class="t-hit">Hit by →</span></div>';

export const weekTitle = (week) => `<span class="ts-side"><b>Week ${esc(week)}</b></span>`;

// A week's legs for the slip (views/slip.js renderWeekTicket), built the way
// state.js legsWithLive builds the current week's, from that week's scoreboard.
function ticketLegs(week) {
  const games = state.standings.boards.get(week) ?? new Map();
  const TYPE_ORDER = ['ml', 'spread', 'total'];
  return Object.entries(slipOf(week)?.picks ?? {}).map(([id, pick]) => {
    const status = games.get(gameKey(...pick.matchup.split(' @ ')))?.status;
    return {
      member: member(id), pick, price: pick.price, fair: pick.fair ?? pick.price / 100, status,
      grade: status && status.state !== 'pre' ? gradePick(pick, status.awayScore, status.homeScore) : null,
      livePrice: null, liveFair: null,
    };
  }).sort((a, b) => a.pick.start - b.pick.start || a.pick.matchup.localeCompare(b.pick.matchup)
    || TYPE_ORDER.indexOf(a.pick.type) - TYPE_ORDER.indexOf(b.pick.type));
}

// The week's standout legs as stickers, slapped on at a tilt: a few words, the number,
// and who. Tapping one opens that member's page.
function stickers(legs) {
  const h = highlights(legs);
  const chance = (l) => `${Math.round(100 * (l.pick.fair ?? l.pick.price / 100))}%`;
  const list = [
    ['🚀', 'Biggest cover', h.biggest, (l) => margin(l.margin), 'hit'],
    ['😅', 'Sweated it', h.closest, (l) => margin(l.margin), 'gold'],
    ['🎲', 'Long shot', h.longshot, chance, 'violet'],
    ['💀', 'Slip killer', h.killer, (l) => esc(l.pick.label), 'miss'],
    ['💔', 'Heartbreaker', h.heartbreak, (l) => margin(l.margin), 'pink'],
    ['🧱', 'Brick', h.brick, (l) => margin(l.margin), 'slate'],
  ].filter(([, , l]) => l);
  const tilts = [-3, 2, -1.5, 2.5, -2, 1.5];
  return `<div class="stickers">${list.map(([emoji, label, l, value, tone], i) => `
    <button class="stk ${tone}" style="--tilt:${tilts[i]}deg" data-action="player" data-id="${esc(l.memberId)}">
      <span class="stk-top"><i>${emoji}</i>${label}</span>
      <span class="stk-who">${avatar(member(l.memberId), 16)}<b>${esc(member(l.memberId).name)}</b><em>${value(l)}</em></span>
    </button>`).join('')}</div>`;
}

// One week: how it did, its standout legs as stickers, and the slip itself.
export function renderWeekPage(week) {
  const s = state.standings;
  if (!s?.legs) return loading();
  const slip = slipOf(week);
  const w = slip && weekResults([slip], s.legs)[0];
  if (!w) return `<div class="st-hero"><h2>Week ${esc(week)}</h2><p>Nothing kept for this week.</p></div>`;
  const legs = s.legs.filter((l) => l.week === week);
  const result = resultOf(w);
  return `
    <div class="st-hero">
      <h2>Week ${esc(week)}</h2>
      <p><span class="st-week-result ${result.cls}">${result.label}</span> · ${w.hits} of ${w.total} hit</p>
    </div>
    ${legs.length ? stickers(legs) : ''}
    <div class="week-slip">${renderWeekTicket(ticketLegs(week))}</div>
    <button class="btn btn-block st-open" data-action="week-go" data-id="${esc(week)}">Open Week ${esc(week)} on the board</button>`;
}

export function renderPlayerPage(id) {
  const s = state.standings;
  if (!s?.legs) return loading();
  const rows = standings(s.legs);
  const r = rows.find((row) => row.memberId === id);
  const m = member(id);
  if (!r) return `<div class="st-hero">${avatar(m, 64)}<h2>${esc(m.name)}</h2><p>No finished legs yet.</p></div>`;

  const best = Math.max(...r.legs.map((l) => l.margin));
  const stat = (label, value, cls = '') => `<div class="info-cell ${cls}"><b>${value}</b><small>${label}</small></div>`;
  const byType = ['ml', 'spread', 'total'].map((type) => {
    const legs = r.legs.filter((l) => l.pick.type === type);
    const hits = legs.filter((l) => l.grade === 'hit').length;
    return stat({ ml: 'Moneyline', spread: 'Spread', total: 'Total' }[type], legs.length ? `${hits}–${legs.length - hits}` : '—');
  }).join('');

  const legRows = [...r.legs].reverse().map(legRow).join('');

  return `
    <div class="st-hero">
      ${avatar(m, 64)}
      <h2>${esc(m.name)}</h2>
      <p>${r.rank === 1 ? '🏆 ' : ''}${ordinal(r.rank)} of ${rows.length}</p>
      <span class="pl-score-badge ${toneOf(r.score)}"><b>${score(r.score)}</b> vs the odds</span>
    </div>
    <div class="info-grid">
      ${stat('Record', record(r))}
      ${stat('Hit rate', pct(r))}
      ${stat('Expected', `${(r.hits + r.misses ? r.expected : 0).toFixed(1)} hits`)}
      ${stat('Avg chance', `${Math.round(100 * r.avgChance)}%`)}
      ${stat('Avg margin', margin(r.avgMargin), toneOf(r.avgMargin))}
      ${stat('Best leg', margin(best), toneOf(best))}
      ${byType}
    </div>
    <div class="cmp st-card">
      <div class="st-head"><span>How close</span><small>Newest first</small></div>
      ${axis}
      ${legRows}
    </div>`;
}

function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}
