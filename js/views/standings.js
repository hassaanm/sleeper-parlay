// The season's standings (a research-style page), in two tabs: the leaderboard, and the
// history of each week's slip. A name opens that member's page (their record and how
// close every leg came); a week opens that week's page (its standout legs and every leg,
// best to worst). The numbers come from history.js.
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
        <button class="st-week" data-action="${w.hits + w.misses ? 'week-page' : 'week-go'}" data-id="${w.week}">
          <span class="st-week-name"><b>Week ${w.week}</b><small>${payout(slipOf(w.week))}× slip</small></span>
          <span class="st-week-tally">${w.hits || w.misses ? `<span class="t-hit">✓ ${w.hits}</span>` : ''}${w.misses ? `<span class="t-miss">✗ ${w.misses}</span>` : ''}${w.pending ? `<span class="muted">${w.pending} to play</span>` : ''}</span>
          <span class="st-week-result ${resultOf(w).cls}">${resultOf(w).label}</span>
          <span class="st-go">${chevronSmall()}</span>
        </button>`).join('') || '<p class="muted center-note">No weeks yet.</p>'}
    </div>`;
  }

  if (!rows.length) return `${hero}<p class="muted center-note">No finished legs yet. Check back after this week’s games.</p>`;
  return `${hero}
    <div class="cmp st-card">
      <div class="st-head"><span>${s.legs.length} ${s.legs.length === 1 ? 'leg' : 'legs'} graded</span><small>Record · hit rate</small></div>
      ${rows.map((r) => `
        <button class="st-row ${r.memberId === state.me ? 'me' : ''}" data-action="player" data-id="${esc(r.memberId)}">
          <span class="st-rank ${r.rank === 1 ? 'top' : ''}">${r.rank}</span>
          ${avatar(member(r.memberId), 30)}
          <span class="st-name"><b>${esc(member(r.memberId).name)}</b><span class="st-dots">${r.legs.map(dot).join('')}</span></span>
          <span class="st-rec"><b>${record(r)}</b><small>${pct(r)}</small></span>
          <span class="st-go">${chevronSmall()}</span>
        </button>`).join('')}
    </div>`;
}

const slipOf = (week) => state.standings.slips.find((slip) => Number(slip.week) === week);
// What the whole slip would pay, as a multiple: every leg's price multiplied together.
const payout = (slip) => Math.round(Object.values(slip?.picks ?? {}).reduce((x, p) => x * (100 / p.price), 1));
const resultOf = (w) => (w.cashed ? { label: 'Cashed', cls: 'cashed' } : w.misses ? { label: 'Busted', cls: 'busted' }
  : { label: w.pending === w.total ? 'Upcoming' : 'Live', cls: '' });

// One leg and how close it came: a bar out from the middle, right for a hit, left for a
// miss, as long as the margin (two touchdowns or more fills it). `who` shows the member
// (a week's page); otherwise the week (a member's page).
function legRow(l, who) {
  const width = Math.min(1, Math.abs(l.margin) / 14) * 50;
  const close = Math.abs(l.margin) <= CLOSE && l.grade !== 'push';
  const m = member(l.memberId);
  return `
    <${who ? `button class="pl-leg tap" data-action="player" data-id="${esc(l.memberId)}"` : 'div class="pl-leg"'}>
      <div class="pl-leg-top">
        ${who ? avatar(m, 22) : `<span class="pl-week">Wk ${l.week}</span>`}
        <b>${esc(l.pick.label)}</b>
        <span class="pl-landed ${l.grade}">${landed(l)}${close ? ' <em>close</em>' : ''}</span>
      </div>
      <div class="pl-bar"><i class="${l.grade}" style="${l.margin >= 0 ? 'left:50%' : 'right:50%'};width:${width}%"></i></div>
      <small class="pl-score">${who ? `${esc(m.name)} · ` : ''}${esc(l.away)} ${l.awayScore} – ${esc(l.home)} ${l.homeScore}</small>
    </${who ? 'button' : 'div'}>`;
}

const axis = '<div class="pl-axis"><span class="t-miss">← Missed by</span><span class="t-hit">Hit by →</span></div>';

export const weekTitle = (week) => `<span class="ts-side"><b>Week ${esc(week)}</b></span>`;

// One week's slip: how it did, its standout legs, and every leg from best to worst.
export function renderWeekPage(week) {
  const s = state.standings;
  if (!s?.legs) return loading();
  const slip = slipOf(week);
  const w = slip && weekResults([slip], s.legs)[0];
  if (!w) return `<div class="st-hero"><h2>Week ${esc(week)}</h2><p>Nothing kept for this week.</p></div>`;
  const legs = s.legs.filter((l) => l.week === week);
  const result = resultOf(w);
  const h = highlights(legs);
  const tile = (label, l, value) => (l ? `
    <button class="st-tile" data-action="player" data-id="${esc(l.memberId)}">
      <small>${label}</small>
      <b class="${l.grade}">${value}</b>
      <span class="st-tile-who">${avatar(member(l.memberId), 18)}${esc(member(l.memberId).name)}</span>
      <span class="st-tile-pick">${esc(l.pick.label)}</span>
    </button>` : '');
  const chance = (l) => Math.round(100 * (l.pick.fair ?? l.pick.price / 100));
  const tiles = [
    tile('Biggest cover', h.biggest, h.biggest && margin(h.biggest.margin)),
    tile('Closest hit', h.closest, h.closest && margin(h.closest.margin)),
    tile('Heartbreaker', h.heartbreak, h.heartbreak && margin(h.heartbreak.margin)),
    tile('Longest shot', h.longshot, h.longshot && `${chance(h.longshot)}%`),
  ].join('');
  return `
    <div class="st-hero">
      <h2>Week ${esc(week)}</h2>
      <p><span class="st-week-result ${result.cls}">${result.label}</span> · ${w.hits} of ${w.total} hit · ${payout(slip)}× slip</p>
    </div>
    ${tiles ? `<div class="st-tiles first">${tiles}</div>` : ''}
    ${legs.length ? `
    <div class="cmp st-card">
      <div class="st-head"><span>Every leg</span><small>Best to worst</small></div>
      ${axis}
      ${[...legs].sort((a, b) => b.margin - a.margin).map((l) => legRow(l, true)).join('')}
    </div>` : ''}
    <button class="btn btn-block st-open" data-action="week-go" data-id="${esc(week)}">Open the Week ${esc(week)} slip</button>`;
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

  const legRows = [...r.legs].reverse().map((l) => legRow(l, false)).join('');

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
      ${axis}
      ${legRows}
    </div>`;
}

function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}
