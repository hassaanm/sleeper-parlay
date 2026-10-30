// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { americanOdds, buildGames, indexOptions, multiplierToAmerican, weekWindowAt } from '../js/lines.js';

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
const TUE = Date.UTC(2026, 10, 3, 10); // Tue Nov 3, 10:00 UTC: the weekly rollover

test('the week rolls over at Tuesday 10:00 UTC', () => {
  assert.deepEqual(weekWindowAt(TUE - 1), { start: TUE - WEEK, end: TUE });
  assert.deepEqual(weekWindowAt(TUE), { start: TUE, end: TUE + WEEK });
  assert.deepEqual(weekWindowAt(TUE + 1), { start: TUE, end: TUE + WEEK });
});

test('Thursday through Monday night games share one window', () => {
  const window = { start: TUE, end: TUE + WEEK };
  assert.deepEqual(weekWindowAt(Date.UTC(2026, 10, 6, 1, 15)), window); // TNF, Thu 8:15 PM ET
  assert.deepEqual(weekWindowAt(Date.UTC(2026, 10, 8, 18)), window); // Sun 1:00 PM ET
  assert.deepEqual(weekWindowAt(Date.UTC(2026, 10, 10, 1, 15)), window); // MNF, Mon 8:15 PM ET
  assert.equal(weekWindowAt(Date.UTC(2026, 10, 1, 17)).start, Date.UTC(2026, 9, 27, 10)); // Sun Nov 1 reaches back into October
});

test('americanOdds turns a price in cents into American odds', () => {
  assert.equal(americanOdds(60), '-150');
  assert.equal(americanOdds(75), '-300');
  assert.equal(americanOdds(40), '+150');
  assert.equal(americanOdds(25), '+300');
  assert.equal(americanOdds(1), '+9900');
  assert.equal(americanOdds(99), '-9900');
  for (const bad of [0, 100, -5, undefined, NaN]) assert.equal(americanOdds(bad), '—');
});

test('multiplierToAmerican matches americanOdds for the same bet', () => {
  assert.equal(multiplierToAmerican(2), '+100');
  assert.equal(multiplierToAmerican(3.5), '+250');
  assert.equal(multiplierToAmerican(1.5), '-200');
  assert.equal(multiplierToAmerican(100 / 60), americanOdds(60)); // a 60¢ contract pays 100/60x
  assert.equal(multiplierToAmerican(100 / 25), americanOdds(25));
  for (const bad of [1, 0.5, undefined, NaN]) assert.equal(multiplierToAmerican(bad), '—');
});

// A minimal lobby: one KC @ DEN game with a moneyline, a spread ladder, and a total ladder.
const KICK = Date.UTC(2026, 10, 8, 18); // Sun 1:00 PM ET
const window = { start: TUE, end: TUE + WEEK };
const mkt = (id, subject, line, yes, no, status = 'active') => ({ market_id: id, subject_id: subject, line, yes_ask: yes, no_ask: no, status });
const ev = (id, over = {}) => ({
  event_id: id, sport: 'nfl', market_type: 'moneyline', expected_start_time: KICK,
  display_data: { away_id: 'KC', home_id: 'DEN', game_status: 'pre_game' }, markets: [], ...over,
});
const lobbyItem = {
  primary_event: ev('g1', { markets: [mkt('ml-kc', 'KC', null, 55, 47), mkt('ml-den', 'DEN', null, 47, 55)] }),
  related_events: [
    // The lobby carries only the main line; the first market is it.
    { event_id: 'g1-spread', market_type: 'spread', markets: [{ market_id: 's3.5' }] },
    { event_id: 'g1-total', market_type: 'total', markets: [{ market_id: 't44.5' }] },
  ],
};
const details = () => new Map([
  ['g1-spread', { event_id: 'g1-spread', markets: [
    mkt('s3.5', 'KC', '3.5', 50, 52),
    mkt('s2.5', 'DEN', '2.5', 25, 77), // DEN -2.5
    mkt('s7.5', 'KC', '7.5', 30, 72),
    mkt('s10.5', 'KC', '10.5', 15, 87, 'closed'),
  ] }],
  ['g1-total', { event_id: 'g1-total', markets: [mkt('t47.5', null, '47.5', 40, 62), mkt('t41.5', null, '41.5', 62, 40), mkt('t44.5', null, '44.5', 50, 52)] }],
]);
const oneGame = (d = details(), now = KICK - HOUR) => buildGames([lobbyItem], d, window, now)[0];

test('buildGames keeps only NFL moneyline events inside the week, sorted by kickoff then matchup', () => {
  const lobby = [
    lobbyItem,
    { primary_event: ev('nba', { sport: 'nba' }) },
    { primary_event: ev('spread-primary', { market_type: 'spread' }) },
    { primary_event: ev('next-week', { expected_start_time: window.end }) },
    { primary_event: ev('last-week', { expected_start_time: window.start - 1 }) },
    ev('g2', { display_data: { away_id: 'BUF', home_id: 'MIA' } }), // a bare event, no lobby wrapper
    { primary_event: ev('g0', { expected_start_time: window.start, display_data: { away_id: 'NYJ', home_id: 'NE' } }) },
  ];
  const games = buildGames(lobby, new Map(), window, window.start - HOUR);
  assert.deepEqual(games.map((g) => g.id), ['g0', 'g2', 'g1']); // BUF @ MIA sorts before KC @ DEN at the same kickoff
  assert.equal(games[2].matchup, 'KC @ DEN');
  assert.deepEqual(games[2].relatedIds, ['g1-spread', 'g1-total']);
});

test('moneyline options are [away, home] with a no-vig fair price', () => {
  const game = oneGame();
  assert.deepEqual(game.ml.map((o) => [o.key, o.label, o.team, o.price]), [['ml-kc:yes', 'KC ML', 'KC', 55], ['ml-den:yes', 'DEN ML', 'DEN', 47]]);
  assert.equal(game.ml[0].fair, 55 / 102); // yes_ask 55 + no_ask 47 = a 102 book
  assert.ok(!game.locked);
  assert.ok(oneGame(details(), KICK).locked);
  // A fetched full event replaces the lobby copy; a side with no active market is null.
  const fresh = details().set('g1', ev('g1', { markets: [mkt('ml-kc', 'KC', null, 60, 42)] }));
  assert.deepEqual(oneGame(fresh).ml.map((o) => o?.price ?? null), [60, null]);
});

test('spread rungs run from away-favored to home-favored and drop closed markets', () => {
  const { rungs, mainIndex } = oneGame().spread;
  assert.deepEqual(rungs.map((r) => [r.away.label, r.home.label]), [['KC -7.5', 'DEN +7.5'], ['KC -3.5', 'DEN +3.5'], ['KC +2.5', 'DEN -2.5']]);
  assert.equal(mainIndex, 1); // s3.5, the lobby's main line
  assert.equal(rungs[1].main, true);
  // DEN is the subject of s2.5, so DEN -2.5 is YES and KC +2.5 is NO.
  assert.deepEqual([rungs[2].home.key, rungs[2].home.team, rungs[2].home.line], ['s2.5:yes', 'DEN', -2.5]);
  assert.deepEqual([rungs[2].away.key, rungs[2].away.team, rungs[2].away.line], ['s2.5:no', 'KC', 2.5]);
});

test('total rungs run low to high, and mainIndex falls back to 0 without a main line', () => {
  const { rungs, mainIndex } = oneGame().total;
  assert.deepEqual(rungs.map((r) => [r.line, r.over.label, r.under.label]), [[41.5, 'Over 41.5', 'Under 41.5'], [44.5, 'Over 44.5', 'Under 44.5'], [47.5, 'Over 47.5', 'Under 47.5']]);
  assert.equal(mainIndex, 1);
  assert.deepEqual([rungs[1].over.key, rungs[1].over.side, rungs[1].under.key, rungs[1].under.side], ['t44.5:yes', 'over', 't44.5:no', 'under']);
  const d = details();
  d.get('g1-total').markets = d.get('g1-total').markets.filter((m) => m.market_id !== 't44.5');
  assert.equal(oneGame(d).total.mainIndex, 0);
});

test('indexOptions finds every option by key', () => {
  const game = oneGame();
  const index = indexOptions([game]);
  assert.equal(index.size, 2 + 3 * 2 + 3 * 2); // 2 moneylines, 3 spread rungs, 3 total rungs
  assert.equal(index.get('ml-kc:yes'), game.ml[0]);
  assert.equal(index.get('s2.5:yes').label, 'DEN -2.5');
  assert.equal(index.get('t44.5:no').label, 'Under 44.5');
  assert.equal(index.get('s10.5:yes'), undefined); // closed market
  const fresh = details().set('g1', ev('g1', { markets: [mkt('ml-kc', 'KC', null, 60, 42)] }));
  assert.equal(indexOptions([oneGame(fresh)]).size, 1 + 3 * 2 + 3 * 2); // the missing DEN moneyline is skipped
});
