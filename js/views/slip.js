// The parlay slip: the phone's pull-up sheet and the desktop sidebar ticket share
// the same header, legs, and totals.
import { multiplierToAmerican } from '../lines.js';
import { pickTeams } from '../rules.js';
import { isTracking, legsWithLive, myLegLocked, picks, state } from '../state.js';
import { avatar, chevron, dayTimeFmt, esc, fmtOdds, pretty, seeded, signSpan, teamLogo } from '../ui.js';

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
    // Everyone with a leg, in slip order. They overlap more as the row fills, so a full
    // league still fits. Your avatar stays hidden while it flies in (app.js flyToSlip).
    const overlap = legs.length > 9 ? -11 : legs.length > 6 ? -9 : -7;
    const faces = legs.map((l) => avatar(l.member, 24, `stacked${l.member.id === state.arriving ? ' arriving' : ''}`, l.member.id)).join('');
    left = `<span class="faces" style="--overlap:${overlap}px">${legs.length ? faces : '<span class="faces-empty">No legs yet</span>'}</span>`;
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
        <li class="leg ${isMine ? 'leg-you' : ''} ${live ? 'leg-live' : ''} ${final ? `leg-final ${l.grade}` : ''}" data-key="${esc(l.member.id)}">
          <span class="leg-logo">${logo}${avatar(l.member, 18, 'leg-face')}</span>
          <div class="leg-body">
            <span class="leg-pick">${esc(pretty(l.pick.label))}${isMine ? ' <em class="you-tag">You</em>' : ''}</span>
            <span class="leg-sub">${sub}</span>
          </div>
          ${stamp}
          <div class="leg-right">
            <span class="leg-odds">${final ? '' : signSpan(fmtOdds(now))}</span>
            <small class="leg-from ${final ? '' : delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${final ? esc(l.member.name) : `${delta > 0 ? '▲' : delta < 0 ? '▼' : 'from'} ${fmtOdds(l.pick.price)}`}</small>
          </div>
        </li>`;
    }

    const sub = `${esc(vs)} · ${esc(dayTimeFmt.format(l.pick.start))}`;
    return `
      <li class="leg ${isMine ? 'leg-mine' : ''}" data-key="${esc(l.member.id)}">
        <span class="leg-logo">${logo}${avatar(l.member, 18, 'leg-face')}</span>
        <div class="leg-body">
          <span class="leg-pick">${esc(pretty(l.pick.label))}</span>
          <span class="leg-sub">${sub}</span>
        </div>
        <div class="leg-right">
          <span class="leg-odds">${signSpan(fmtOdds(l.price))}</span>
          ${isMine && !myLegLocked()
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
        <div><dt>${state.oddsFormat === 'pct' ? 'Fair chance' : 'Fair odds'}</dt><dd>${signSpan(fair.odds)}</dd></div>
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
// The paper behind the slip; its side notches sit on the tear line (see syncTearLine).
const paper = (kind) => {
  const tear = state.tear[kind];
  return `<div class="paper" data-paper="${kind}" aria-hidden="true"${tear == null ? '' : ` style="--tear:${tear}px"`}></div>`;
};

export function renderParlayCard() {
  return `<div class="parlay-card ticket">${paper('ticket')}${slipHeader(false)}<div class="sheet-body">${parlayLegs()}</div>${parlayFoot()}</div>`;
}

// Phone: the slip lives at the bottom of the screen. Closed, its top edge peeks up
// (who's in, your leg); drag it or tap it to pull up the full slip. It's one element in
// both states, so it never jumps or changes width.
export function renderSlip() {
  const classes = ['slip-wrap', state.sheetOpen && 'open', state.nudging && 'nudge', isTracking(legsWithLive()) && 'tracking'].filter(Boolean).join(' ');
  return `
  <div class="${classes}">
    <div class="slip-backdrop" data-action="close-sheet"></div>
    <section class="slip" aria-label="The parlay">
      ${paper('slip')}
      <div class="slip-handle" role="button" tabindex="0" aria-expanded="${state.sheetOpen}" aria-label="Show or hide the parlay">
        ${slipHeader(true)}
      </div>
      <div class="sheet-body">${parlayLegs()}</div>
      ${parlayFoot()}
    </section>
  </div>`;
}

// Your leg, shortened: the team logo (both logos for a total) and just the number,
// e.g. [JAX] −9.5, [KC] ML, [MIN][DET] U 45.5.
function myLegChip(pick) {
  const { team, away, home } = pickTeams(pick);
  const logos = team ? teamLogo(team, 18) : `${teamLogo(away, 16)}${teamLogo(home, 16)}`;
  const short = pick.type === 'ml' ? 'ML' : pick.type === 'total' ? pick.label.replace(/^(Over|Under) /, (m) => `${m[0]} `) : pretty(pick.label.split(' ').slice(1).join(' '));
  return `<span class="my-leg">${logos}<b>${esc(short)}</b></span>`;
}
