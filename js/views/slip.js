// The parlay slip: the phone's pull-up sheet and the desktop sidebar ticket share
// the same header, legs, and totals.
import { multiplierToAmerican } from '../lines.js';
import { pickTeams } from '../rules.js';
import { isTracking, legsWithLive, myLegLocked, picks, state } from '../state.js';
import { avatar, chevron, dayTimeFmt, esc, fmtChance, fmtLine, fmtOdds, pretty, signSpan, teamLogo } from '../ui.js';

// Fair (no-vig) parlay: multiply each leg's fair probability. A reference for what
// the slip should pay, since the real price is set wherever the parlay gets placed.
function fairParlay(legs) {
  const prob = legs.reduce((acc, l) => acc * l.fair, 1);
  const mult = 1 / prob;
  const odds = state.oddsFormat === 'pct'
    ? fmtChance(prob)
    : multiplierToAmerican(mult).replace(/\d+/, (n) => Number(n).toLocaleString());
  return { odds, mult: mult >= 100 ? Math.round(mult).toLocaleString() : mult.toFixed(1) };
}

// The slip's top row (also the peek when it's closed): everyone who's in on the left;
// on the right, your leg, or once legs finish, how many hit (✓) and missed (✗); then
// the open/close chevron.
function slipHeader(withChevron) {
  const legs = legsWithLive();
  const mine = picks()[state.me];
  const final = (grades) => legs.filter((l) => l.status?.state === 'post' && grades.includes(l.grade)).length;
  const hit = final(['hit', 'push']);
  const miss = final(['miss']);
  // Everyone with a leg, in slip order. They overlap more as the row fills, so a full
  // league still fits. data-pick lets faces.js tell a changed pick (a hop) from a shuffle.
  const overlap = legs.length > 12 ? -14 : legs.length > 9 ? -11 : legs.length > 6 ? -9 : -7;
  const faces = legs.map((l) => avatar(l.member, 24, 'stacked', l.member.id, ` data-pick="${esc(l.pick.optKey)}"`)).join('');
  // Only counts that aren't zero; live legs show their scores in the slip itself.
  const right = hit || miss
    ? `<span class="tally">${hit ? `<span class="t-hit">✓ ${hit}</span>` : ''}${miss ? `<span class="t-miss">✗ ${miss}</span>` : ''}</span>`
    : mine ? myLegChip(mine) : myLegLocked() || isTracking(legs) ? '' : '<span class="my-leg empty">Add your leg</span>';
  return `
    <div class="slip-peek">
      <span class="faces" style="--overlap:${overlap}px">${legs.length ? faces : '<span class="faces-empty">No legs yet</span>'}</span>
      <span class="peek-right">
        ${right}
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
      : `<span class="logo-pair">${teamLogo(away, 20)}${teamLogo(home, 20)}</span>`;
    const isMine = l.member.id === state.me;
    const st = l.status;
    const live = st?.state === 'in';
    const final = st?.state === 'post';
    const score = st && st.state !== 'pre'
      ? `<span class="leg-score"><i>${esc(away)}</i><b>${st.awayScore}</b><span>–</span><b>${st.homeScore}</b><i>${esc(home)}</i></span>`
      : '';

    if (tracking) {
      // Tracking row: the pick, then the game's clock and score underneath. On the
      // right: a ✓ or ✗ once it's final; while live, the chance now, green while it's at
      // or above where it started and red below; then who has it.
      const sub = live
        ? `<span class="live-tag">● ${esc(st.detail)}</span>${score}`
        : final ? `<span>Final</span>${score}` : `<span>${esc(vs)} · ${esc(dayTimeFmt.format(l.pick.start))}</span>`;
      const now = live && l.livePrice ? l.livePrice : l.price;
      const mark = { hit: '<b class="mark hit">✓</b>', miss: '<b class="mark miss">✗</b>', push: '<b class="mark push">–</b>' }[l.grade];
      return `
        <li class="leg ${isMine ? 'leg-you' : ''} ${live ? 'leg-live' : ''} ${final ? `leg-final ${l.grade}` : ''}" data-key="${esc(l.member.id)}">
          <span class="leg-logo">${logo}${avatar(l.member, 18, 'leg-face')}</span>
          <div class="leg-body">
            <span class="leg-pick">${esc(pretty(l.pick.label))}${isMine ? ' <em class="you-tag">You</em>' : ''}</span>
            <span class="leg-sub">${sub}</span>
          </div>
          <div class="leg-right">
            ${final ? `<span class="leg-odds">${mark}</span>` : `<span class="leg-odds ${live ? (now >= l.pick.price ? 'up' : 'down') : ''}">${signSpan(fmtOdds(now))}</span>`}
            <small class="leg-from">${esc(l.member.name)}</small>
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
  const busted = legs.some((l) => l.status?.state === 'post' && l.grade === 'miss');
  const hits = legs.filter((l) => l.status?.state === 'post' && l.grade !== 'miss').length;
  return `
    <dl class="parlay-foot ${busted ? 'busted' : ''}">
      <div><dt>Legs hit</dt><dd>${hits} of ${legs.length}</dd></div>
      <div><dt>Current chance</dt><dd>${fmtChance(liveProb)}</dd></div>
      <div><dt>Fair payout</dt><dd>${fair.mult}×</dd></div>
    </dl>`;
}

// The paper behind the slip; its side notches sit on the tear line (see syncTearLine).
const paper = (kind) => {
  const tear = state.tear[kind];
  return `<div class="paper" data-paper="${kind}" aria-hidden="true"${tear == null ? '' : ` style="--tear:${tear}px"`}></div>`;
};

// Desktop: the same ticket as the phone slip, always open in the sidebar.
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
  const short = pick.type === 'ml' ? 'ML' : pick.type === 'total' ? pick.label.replace(/^(Over|Under) /, (m) => `${m[0]} `) : fmtLine(pick.line);
  return `<span class="my-leg">${logos}<b>${esc(short)}</b></span>`;
}
