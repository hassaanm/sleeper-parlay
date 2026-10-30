// Research pages, shown in a tall sheet over the board: a team's season, and a
// head-to-head matchup.
import * as api from '../api.js';
import { gameKey } from '../rules.js';
import { conferenceOf, matchupColors, nickname, teamColor, teamName } from '../teams.js';
import { commonOpponents, headToHead, recordOf, resume, winChains } from '../research.js';
import { awayWinPct } from '../lines.js';
import { gameById, state } from '../state.js';
import { chevron, chevronSmall, dayTimeFmt, esc, fmt1, fmtPct, fmtSigned, rankTier, rankText, resultChip, shortDayFmt, teamLogo, timeFmt, toneOf, tvBadges, weatherIcon } from '../ui.js';

// Research pages open as a tall sheet. The back/close buttons sit in the top corners
// over the hero; once you scroll, the top bar turns solid and shows a title.
export function renderPage() {
  const current = state.pages.at(-1);
  const game = current.kind === 'matchup' ? gameById(current.gameId) : null;
  const title = current.kind === 'team'
    ? `<span class="ts-side">${teamLogo(current.abbr, 20)}<b>${esc(teamName(current.abbr))}</b></span>`
    : game ? `<span class="ts-side">${teamLogo(game.away, 20)}<b>${esc(game.away)}</b></span><span class="ts-side"><b>${esc(game.home)}</b>${teamLogo(game.home, 20)}</span>` : '';
  const content = current.kind === 'team' ? renderTeamPage(current.abbr) : renderMatchupPage(current.gameId);
  return `
  <div class="sheet-backdrop" data-action="close-page"></div>
  <div class="tsheet" role="dialog" aria-label="Research" data-kind="${current.kind}" style="${heroColors(current, game)}">
    <div class="ts-bar" style="${barColors(current, game)}">
      ${state.pages.length > 1 ? `<button class="round-btn" data-action="page-back" aria-label="Back">${chevron('left')}</button>` : '<span class="round-spacer"></span>'}
      <span class="ts-title" data-action="page-top">${title}</span>
      <button class="round-btn" data-action="close-page" aria-label="Close">${chevron('down')}</button>
    </div>
    <div class="tsheet-body"><div class="page">${content}</div></div>
  </div>`;
}

// The hero's colors, on the sheet too, for the band behind it (styles.css .tsheet::before).
function heroColors(page, game) {
  if (page.kind === 'team') return `--team:${teamColor(page.abbr)}`;
  if (!game) return '';
  const colors = matchupColors(game.away, game.home);
  return `--away:${colors.away};--home:${colors.home}`;
}

// Team colors for the top bar's tint once it turns solid: one team's color across a
// team page; away fading into home on a matchup.
function barColors(page, game) {
  if (page.kind === 'team') {
    const c = teamColor(page.abbr);
    return `--bar-left:${c};--bar-right:${c}`;
  }
  if (!game) return '';
  const colors = matchupColors(game.away, game.home);
  return `--bar-left:${colors.away};--bar-right:${colors.home}`;
}

const researchLoading = () => {
  if (state.research.error) return `<p class="muted center-note">Couldn’t load season data: ${esc(state.research.error)}</p>`;
  return '<div class="loading-block small"><div class="spinner"></div><p class="muted">Loading the season…</p></div>';
};

function rankRow(label, value, rank, size) {
  const pct = rank ? ((size - rank + 1) / size) * 100 : 0;
  return `
    <div class="rk-row">
      <span class="rk-label">${label}</span>
      <span class="rk-val">${value}${rankText(rank)}</span>
      <span class="rk-bar"><i class="${rankTier(rank, size)}" style="width:${pct}%"></i></span>
    </div>`;
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

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });

// A player's headshot. One that failed to load stays hidden (app.js records failures).
function headshot(playerId) {
  const src = api.playerHeadshot(playerId);
  return `<img src="${esc(src)}" alt="" loading="lazy"${state.failedImages.has(src) ? ' style="visibility:hidden"' : ''}>`;
}

function renderTeamPage(abbr) {
  const info = state.sports?.teams.get(abbr);
  const league = state.research.league;
  const t = league?.teams.get(abbr);
  const color = teamColor(abbr);
  const upNext = state.games.find((g) => (g.away === abbr || g.home === abbr) && !g.locked);
  const opp = upNext && (upNext.home === abbr ? upNext.away : upNext.home);
  const size = league?.size ?? 32;
  const diff = info?.pointDiff;
  const [divRank, ...divName] = (info?.standing ?? '').split(' in ');

  const stat = (label, value, cls = '') => `<div class="info-cell ${cls}"><b>${value ?? '—'}</b><small>${label}</small></div>`;
  const hero = `
    <div class="tp-hero" style="--team:${color}">
      <span class="logo-disc">${teamLogo(abbr, 72)}</span>
      <h2>${esc(teamName(abbr))}</h2>
    </div>
    ${upNext ? `
      <button class="tp-next" data-action="matchup" data-id="${esc(upNext.id)}">
        <span class="tp-next-tag">This week</span>
        <b>${upNext.home === abbr ? 'vs' : '@'} ${teamLogo(opp, 20)} ${esc(nickname(opp))}</b>
        <small>${esc(dayTimeFmt.format(upNext.start))}</small>
        <span class="tp-next-go">${chevronSmall()}</span>
      </button>` : ''}
    <div class="info-grid">
      ${stat('Record', esc(t?.record ?? info?.record ?? '—'))}
      ${stat(esc(divName.join(' in ') || 'Division'), esc(divRank || '—'))}
      ${stat('Streak', esc(info?.streak ?? '—'))}
      ${stat('Home', esc(info?.homeRecord ?? '—'))}
      ${stat('Road', esc(info?.roadRecord ?? '—'))}
      ${stat('Point diff', diff == null ? '—' : fmtSigned(diff), toneOf(diff))}
    </div>`;

  if (!league) return hero + researchLoading();
  if (!t) return hero + '<p class="muted center-note">No games yet this season.</p>';

  // Offense, defense, and sacks & turnovers as wide cards: the header row carries the
  // headline number and its rank (points scored, points allowed, turnover margin), then
  // the unit's numbers sit side by side. On the defense card, everything is allowed.
  const cells = (rows) => rows.map(([label, key, show = fmt1]) => rankRow(label, show(t.per[key]), t.ranks[key], size)).join('');
  const unitCard = (label, rank, value, unit, cells) => `
    <div class="cmp unit-card">
      <div class="card-head"><span>${label}</span><span class="unit-rank"><b>${value}</b><small>${unit}</small>${rankText(rank)}</span></div>
      <div class="unit-cells">${cells}</div>
    </div>`;

  return `${hero}
    ${unitCard('Offense', t.ranks.points, fmt1(t.per.points), 'pts/g', cells([
      ['PASS YDS / G', 'passYd'], ['RUSH YDS / G', 'rushYd'], ['TOTAL YDS / G', 'yards'],
      ['YDS / PLAY', 'yardsPerPlay'], ['3RD DOWN', 'thirdPct', fmtPct], ['RED ZONE TD', 'redZonePct', fmtPct],
    ]))}
    ${unitCard('Defense', t.ranks.allowed, fmt1(t.per.allowed), 'opp pts/g', cells([
      ['PASS YDS / G', 'oppPassYd'], ['RUSH YDS / G', 'oppRushYd'], ['TOTAL YDS / G', 'yardsAllowed'],
      ['YDS / PLAY', 'oppYardsPerPlay'], ['3RD DOWN', 'oppThirdPct', fmtPct], ['RED ZONE TD', 'oppRedZonePct', fmtPct],
    ]))}
    ${unitCard('Sacks & turnovers', t.ranks.turnoverMargin, fmtSigned(t.per.turnoverMargin), 'margin', cells([
      ['SACKS', 'sacks', String], ['TAKEAWAYS', 'takeaways', String], ['GIVEAWAYS', 'giveaways', String],
    ]))}

    <div class="cmp">
      <div class="card-head"><span>Season</span></div>
      <ol class="sched${t.games.some((g) => g.week >= 10) ? ' wide-wk' : ''}">
        ${t.games.map((g) => `
          <li class="sched-row">
            <span class="sched-wk">${g.week}</span>
            <button class="sched-opp" data-action="team" data-id="${esc(g.opp)}"><span class="sched-ha">${g.home ? 'vs' : '@'}</span>${teamLogo(g.opp, 22)}<b>${esc(g.opp)}</b></button>
            ${resultChip(g.result)}
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
            <span class="pl-head">${headshot(p.player_id)}</span>
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
  const game = gameById(gameId);
  if (!game) return '<p class="muted center-note">This game isn’t on the board anymore.</p>';
  const { away: A, home: H } = game;
  const league = state.research.league;
  const colors = matchupColors(A, H);
  const awayPct = awayWinPct(game);
  const teamInfo = (abbr) => state.sports?.teams.get(abbr);
  const info = state.sports?.games.get(gameKey(A, H));
  const teamHead = (abbr) => `
    <button class="mp-team" data-action="team" data-id="${esc(abbr)}" style="--team:${abbr === A ? colors.away : colors.home}">
      <span class="logo-disc">${teamLogo(abbr, 58)}</span>
      <b>${esc(nickname(abbr))}</b>
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
  const rank = (r) => (r ? rankText(r) : '');
  // Each card's first row names the section, between the two teams' columns.
  const cmpHead = (title) => `<div class="cmp-head"><span>${teamLogo(A, 16)}${esc(A)}</span><span class="cmp-title">${title}</span><span>${esc(H)}${teamLogo(H, 16)}</span></div>`;

  // Away value hugs the left edge, home value the right edge; the label and a bar in
  // team colors sit between (the bigger share of the bar is the better number).
  // Per-game numbers show one decimal; season counts (sacks, takeaways) show whole.
  const compareRow = (label, av, hv, aRank, hRank, higherIsBetter = true, show = fmt1) => {
    // Shift both values above zero first, so a negative (a turnover margin) still splits.
    const floor = Math.min(av, hv, 0);
    const goodA = (higherIsBetter ? av : hv) - floor + (floor < 0 ? 1 : 0);
    const goodH = (higherIsBetter ? hv : av) - floor + (floor < 0 ? 1 : 0);
    const aShare = goodA + goodH ? Math.round((100 * goodA) / (goodA + goodH)) : 50;
    const numeric = typeof av === 'number' && typeof hv === 'number';
    const aBetter = numeric && (higherIsBetter ? av > hv : av < hv);
    const hBetter = numeric && (higherIsBetter ? hv > av : hv < av);
    return `
      <div class="cmp-row">
        <span class="cmp-val ${aBetter ? 'better' : ''}"><b>${typeof av === 'number' ? show(av) : esc(av)}</b>${rank(aRank)}</span>
        <span class="cmp-mid">
          <span class="cmp-label">${label}</span>
          <span class="cmp-bar"><i style="flex-basis:${aShare}%;background:var(--away)"></i><i style="flex-basis:${100 - aShare}%;background:var(--home)"></i></span>
        </span>
        <span class="cmp-val right ${hBetter ? 'better' : ''}"><b>${typeof hv === 'number' ? show(hv) : esc(hv)}</b>${rank(hRank)}</span>
      </div>`;
  };

  // Season stats in three groups: the offense, what the defense allows, then sacks and
  // turnovers. Each row's bar favors the better number.
  const statRows = (rows) => rows.map(([label, key, higher, show]) => compareRow(label, a.per[key], h.per[key], a.ranks[key], h.ranks[key], higher, show)).join('');
  const seasonStats = `
    <div class="cmp-group"><span>Offense</span></div>
    ${statRows([
      ['PTS / G', 'points', true],
      ['PASS YDS / G', 'passYd', true],
      ['RUSH YDS / G', 'rushYd', true],
      ['TOTAL YDS / G', 'yards', true],
      ['YDS / PLAY', 'yardsPerPlay', true],
      ['3RD DOWN %', 'thirdPct', true, fmtPct],
      ['RED ZONE TD %', 'redZonePct', true, fmtPct],
    ])}
    <div class="cmp-group"><span>Defense</span></div>
    ${statRows([
      ['OPP PTS / G', 'allowed', false],
      ['OPP PASS YDS / G', 'oppPassYd', false],
      ['OPP RUSH YDS / G', 'oppRushYd', false],
      ['OPP TOTAL YDS / G', 'yardsAllowed', false],
      ['OPP YDS / PLAY', 'oppYardsPerPlay', false],
      ['OPP 3RD DOWN %', 'oppThirdPct', false, fmtPct],
      ['OPP RED ZONE TD %', 'oppRedZonePct', false, fmtPct],
    ])}
    <div class="cmp-group"><span>Sacks &amp; turnovers</span></div>
    ${statRows([
      ['SACKS', 'sacks', true, String],
      ['TAKEAWAYS', 'takeaways', true, String],
      ['GIVEAWAYS', 'giveaways', false, String],
      ['TURNOVER MARGIN', 'turnoverMargin', true, fmtSigned],
    ])}`;

  // Same layout as compareRow, without a winner or bar: for rows that describe each
  // team rather than rank them. `tones` colors each side (good or bad).
  const plainRow = (label, left, right, tones = []) => `
    <div class="cmp-row plain-row">
      <span class="cmp-val plain ${tones[0] ?? ''}"><b>${esc(left)}</b></span>
      <span class="cmp-mid"><span class="cmp-label">${label}</span></span>
      <span class="cmp-val plain right ${tones[1] ?? ''}"><b>${esc(right)}</b></span>
    </div>`;

  const ra = resume(league, A);
  const rh = resume(league, H);
  const signedNum = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt1(Math.abs(n))}`;

  const meetingsThisSeason = headToHead(league, A, H);
  const past = state.pastMeetings.get(gameKey(A, H));
  // Sleeper numbers playoff weeks 1-4: wild card through the Super Bowl.
  const conference = conferenceOf(A);
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
    <span class="gl ${side}">${resultChip(g.result)}<b>${g.pf}–${g.pa}</b><small>Wk ${g.week} · ${g.home ? 'home' : 'away'}</small></span>`;

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
    <div class="cmp">${cmpHead('Season stats')}${seasonStats}</div>

    <div class="cmp">
      ${cmpHead('Track record')}
      ${plainRow('VS WINNING TEAMS', ra.vsWinning, rh.vsWinning)}
      ${plainRow('LAST 3', ra.last3, rh.last3)}
      ${plainRow('ROAD · HOME', ra.road, rh.home)}
      ${plainRow('AVG MARGIN', signedNum(ra.margin), signedNum(rh.margin), [toneOf(ra.margin), toneOf(rh.margin)])}
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
