// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveOf, gradedLegs, highlights, pastWeeks, standings, weekResults } from '../js/history.js';
import { pickMargin } from '../js/rules.js';

const leg = (over) => ({ optKey: 'k', label: 'x', matchup: 'KC @ DEN', type: 'ml', team: 'KC', price: 50, fair: 0.5, start: 1, ...over });
const final = (away, home, awayScore, homeScore, state = 'post') => [`${away}@${home}`, { status: { state, awayScore, homeScore } }];

test('a pick lands by its margin from the line', () => {
  assert.equal(pickMargin(leg(), 27, 20), 7);
  assert.equal(pickMargin(leg({ type: 'spread', line: -3.5 }), 27, 20), 3.5);
  assert.equal(pickMargin(leg({ type: 'spread', team: 'DEN', line: 3.5 }), 27, 20), -3.5);
  assert.equal(pickMargin(leg({ type: 'total', side: 'over', line: 44.5 }), 27, 20), 2.5);
  assert.equal(pickMargin(leg({ type: 'total', side: 'under', line: 44.5 }), 27, 20), -2.5);
});

test('only legs on finished games are graded', () => {
  const slip = { week: 8, picks: { a: leg(), b: leg({ matchup: 'BUF @ MIA', team: 'MIA' }) } };
  const games = new Map([final('KC', 'DEN', 24, 21), final('BUF', 'MIA', 7, 3, 'in')]);
  const legs = gradedLegs([{ slip, games }]);
  assert.deepEqual(legs.map((l) => [l.memberId, l.grade, l.margin]), [['a', 'hit', 3]]);
  assert.deepEqual(weekResults([slip], legs), [{ week: 8, total: 2, hits: 1, misses: 0, pending: 1, cashed: false, missedBy: [] }]);
});

test('standings rank by hits, then misses, then margin, with ties sharing a rank', () => {
  const l = (memberId, grade, margin) => ({ memberId, grade, margin, week: 8, pick: leg() });
  const rows = standings([l('a', 'hit', 2), l('b', 'hit', 9), l('c', 'miss', -1), l('d', 'hit', 9), l('a', 'miss', -4)]);
  assert.deepEqual(rows.map((r) => [r.memberId, r.rank]), [['b', 1], ['d', 1], ['a', 3], ['c', 4]]);
  assert.equal(rows[2].pct, 0.5);
  assert.equal(rows[2].close, 1);
});

test('highlights pick the biggest cover, closest calls, and longest shot', () => {
  const l = (grade, margin, fair, start = 1) => ({ grade, margin, pick: leg({ fair, start }) });
  const h = highlights([l('hit', 14, 0.6), l('hit', 0.5, 0.7), l('hit', 3, 0.25), l('miss', -0.5, 0.5, 1), l('miss', -10, 0.5, 2), l('miss', -4, 0.5, 1)]);
  assert.deepEqual([h.biggest.margin, h.closest.margin, h.heartbreak.margin, h.longshot.margin], [14, 0.5, -0.5, 3]);
  assert.deepEqual([h.brick.margin, h.killer.margin], [-10, -4]);
});

test('a finished week is kept locked, and only this season’s earlier weeks are listed', () => {
  const kept = archiveOf({ season: '2026', week: 8, picks: { a: leg() }, members: [], settings: { locked: false, cutoff: 5 } });
  assert.equal(kept.settings.locked, true);
  const main = { season: '2026', week: 9, history: { '2026-8': kept, '2025-17': { ...kept, season: '2025' } } };
  assert.deepEqual(pastWeeks(main).map((h) => h.week), [8]);
});
