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

    if (tracking) {
      // Tracking row: the pick and, on the right, a ✓ or ✗ once it's final, or while
      // live the chance now (green at or above where it started, red below). Then one
      // line: the clock (or Final), the down and spot centered over the bar's middle (the
      // arrow on the side of the team with the ball), and who has it, shrinking to fit.
      // Once the game starts, the bar (gameBar).
      const when = live
        ? `<span class="live-tag">● ${esc(st.detail)}</span>`
        : final ? 'Final' : `${esc(vs)} · ${esc(dayTimeFmt.format(l.pick.start))}`;
      // The down and the spot meet at a "·" right over the bar's middle; the arrow on the
      // ball's side.
      const hasDown = live && st.possession && st.downDistance;
      const awayBall = st?.possession === away;
      const downL = hasDown ? `<span class="dd">${awayBall ? '<i class="tri">◀</i>' : ''}${esc(st.downDistance)}</span>` : '';
      const downR = hasDown ? `<span class="dd">${esc(st.spot ?? '')}${awayBall ? '' : '<i class="tri">▶</i>'}</span>` : '';
      const now = live && l.livePrice ? l.livePrice : l.price;
      const mark = { hit: '<b class="mark hit">✓</b>', miss: '<b class="mark miss">✗</b>', push: '<b class="mark push">–</b>' }[l.grade];
      return `
        <li class="leg tracked ${live ? 'leg-live' : ''} ${final ? `leg-final ${l.grade}` : ''}" data-key="${esc(l.member.id)}">
          <span class="leg-logo">${logo}${avatar(l.member, 18, 'leg-face')}</span>
          <span class="leg-pick">${esc(pretty(l.pick.label))}</span>
          ${final ? `<span class="leg-odds">${mark}</span>` : `<span class="leg-odds ${live ? (now >= l.pick.price ? 'up' : 'down') : ''}">${signSpan(fmtOdds(now))}</span>`}
          <div class="leg-line">
            <span class="ll-side"><span class="ll-when">${when}</span>${downL}</span>
            <span class="ll-dot">${hasDown ? '·' : final ? `<span class="ll-result ${l.grade}">${barLabel(l.pick, st, true)}</span>` : ''}</span>
            <span class="ll-side right">${downR}<small class="ll-who ${isMine ? 'me' : ''}">${esc(l.member.name)}</small></span>
          </div>
          ${live || final ? gameBar(l.pick, st) : ''}
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

// A started leg's game as a bar: away's logo and score on the left, home's on the right.
// A total fills from 0 toward the line (its tick near the right end); a spread or
// moneyline starts from the middle (a tie, or the picked side's spread) and the dot
// moves toward the side winning the leg: a lot near the middle, tapering off for big
// leads. The dot stays clear of the bar's ends, so the label under it (barLabel) always
// fits right under it.
// Green while the leg is winning, red while it's losing.
const LINE_AT = 88; // a total's line, in % along the bar
const DOT_MIN = 6;
const DOT_MAX = 94;
// What the bar's dot stands for: the running total, or the picked team's lead ("+3",
// "−4", "Tie"); with the team ("ARI +34") when it's shown away from the bar, on a
// finished leg's middle line. The sign hangs off the number's left, so the number
// itself sits under the dot.
function barLabel(pick, st, withTeam = false) {
  if (pick.type === 'total') return `${st.awayScore + st.homeScore}${withTeam ? ' pts' : ''}`;
  const [away] = pick.matchup.split(' @ ');
  const lead = pick.team === away ? st.awayScore - st.homeScore : st.homeScore - st.awayScore;
  if (lead === 0) return 'Tie';
  return withTeam
    ? `${esc(pick.team)} ${fmtLine(lead)}`
    : `<span class="num"><span class="sg">${lead > 0 ? '+' : '−'}</span>${Math.abs(lead)}</span>`;
}

function gameBar(pick, st) {
  const [away, home] = pick.matchup.split(' @ ');
  const final = st.state === 'post';
  let at, tone, from = 50;
  if (pick.type === 'total') {
    const pts = st.awayScore + st.homeScore;
    tone = (pick.side === 'over') === (pts > pick.line) ? 'win' : 'lose';
    at = Math.max(DOT_MIN, Math.min(DOT_MAX, (pts / pick.line) * LINE_AT));
    from = 0;
  } else {
    const pickedHome = pick.team === home;
    const lead = pickedHome ? st.homeScore - st.awayScore : st.awayScore - st.homeScore;
    const margin = lead + (pick.type === 'spread' ? pick.line : 0); // 0: right on the line
    at = 50 + (DOT_MAX - 50) * Math.tanh(margin / 14) * (pickedHome ? 1 : -1);
    tone = margin > 0 ? 'win' : margin < 0 ? 'lose' : 'tie';
  }
  const lost = (mine, theirs) => (final && mine < theirs ? 'lost' : '');
  // Once final, the label moves up to the middle of the line above (barLabel), so a
  // finished leg needs no row under its bar.
  return `
    <div class="leg-game ${tone} ${final ? 'final' : ''}">
      ${teamLogo(away, 14)}<b class="gs-away ${lost(st.awayScore, st.homeScore)}">${st.awayScore}</b>
      <span class="gbar">
        <i class="gbar-fill" style="left:${Math.min(from, at)}%;width:${Math.abs(at - from)}%"></i>
        <i class="gbar-tick" style="left:${pick.type === 'total' ? LINE_AT : 50}%"></i>
        <i class="gbar-dot" style="left:${at}%"></i>
        ${final ? '' : `<small class="gbar-lbl" style="left:${at}%">${barLabel(pick, st)}</small>`}
      </span>
      <b class="gs-home ${lost(st.homeScore, st.awayScore)}">${st.homeScore}</b>${teamLogo(home, 14)}
    </div>`;
}

// Receipt-style totals: leg count, fair odds, and what that would pay. Fair means each
// leg's price with the vig removed, multiplied together. While tracking, the chance is
// recomputed live: finished legs count as 100% (hit or push) or 0% (miss), live legs use
// the market's current price, the rest their current price. The payout then stays at
// the original one, from each leg's price when it was picked.
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
  // Once underway, the payout is the one the slip was built at (each leg's fair price when
  // it was picked), so it holds still while the chance moves.
  const original = fairParlay(legs.map((l) => ({ ...l, fair: l.pick.fair ?? l.pick.price / 100 })));
  return `
    <dl class="parlay-foot ${busted ? 'busted' : ''}">
      <div><dt>Legs hit</dt><dd>${hits} of ${legs.length}</dd></div>
      <div><dt>Current chance</dt><dd>${fmtChance(liveProb)}</dd></div>
      <div><dt>Original payout</dt><dd>${original.mult}×</dd></div>
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
