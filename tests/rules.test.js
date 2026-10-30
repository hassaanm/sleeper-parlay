// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clashFor, gradePick, legLockedReason, pickBlockedReason, pickFrom, pickTeams, slipLocked } from '../js/rules.js';

const HOUR = 3_600_000;
const now = Date.UTC(2026, 10, 1, 17); // Sun 12:00 PM CT
const pick = (over) => ({ optKey: 'm1:yes', gameId: 'g1', type: 'spread', label: 'KC -3.5', matchup: 'KC @ DEN', price: 50, start: now + HOUR, ...over });
const slip = (over = {}) => ({ settings: {}, picks: {}, ...over });

test('a slip locks by hand or when the deadline passes', () => {
  assert.equal(slipLocked(slip(), now), false);
  assert.equal(slipLocked(slip({ settings: { locked: true } }), now), true);
  assert.equal(slipLocked(slip({ settings: { cutoff: now + 1 } }), now), false);
  assert.equal(slipLocked(slip({ settings: { cutoff: now } }), now), true);
});

test('a leg is locked in once its game kicks off', () => {
  const s = slip({ picks: { me: pick({ start: now - 1 }) } });
  assert.match(legLockedReason(s, 'me', now), /started/);
  assert.equal(legLockedReason(slip({ picks: { me: pick() } }), 'me', now), null);
  assert.equal(legLockedReason(slip(), 'me', now), null);
});

test('picks are blocked on started games and games before the deadline', () => {
  assert.equal(pickBlockedReason(slip(), 'me', now + HOUR, { now }), null);
  assert.match(pickBlockedReason(slip(), 'me', now - 1, { now }), /has started/);
  assert.match(pickBlockedReason(slip({ settings: { cutoff: now + 2 * HOUR } }), 'me', now + HOUR, { now }), /before picks lock/);
});

test('the admin can change a locked leg, but not into a started game', () => {
  const s = slip({ settings: { locked: true }, picks: { me: pick({ start: now - 1 }) } });
  assert.match(pickBlockedReason(s, 'me', now + HOUR, { now }), /locked/);
  assert.equal(pickBlockedReason(s, 'me', now + HOUR, { admin: true, now }), null);
  assert.match(pickBlockedReason(s, 'me', now - 1, { admin: true, now }), /has started/);
});

test('one leg per game and bet type', () => {
  const s = slip({ picks: { them: pick() } });
  assert.equal(clashFor(s, 'me', { gameId: 'g1', type: 'spread' }).userId, 'them');
  assert.equal(clashFor(s, 'me', { gameId: 'g1', type: 'total' }), null);
  assert.equal(clashFor(s, 'them', { gameId: 'g1', type: 'spread' }), null);
  assert.equal(clashFor(slip({ ...s, settings: { blockSameGame: true } }), 'me', { gameId: 'g1', type: 'total' }).userId, 'them');
});

test('spreads, totals, and moneylines grade against the score', () => {
  assert.equal(gradePick(pick(), 24, 20), 'hit'); // KC -3.5 wins by 4
  assert.equal(gradePick(pick(), 23, 20), 'miss');
  assert.equal(gradePick(pick({ label: 'DEN +3.5' }), 23, 20), 'hit');
  assert.equal(gradePick(pick({ label: 'KC −3' }), 23, 20), 'push'); // typographic minus
  assert.equal(gradePick(pick({ type: 'total', label: 'Over 44.5' }), 24, 21), 'hit');
  assert.equal(gradePick(pick({ type: 'total', label: 'Under 44.5' }), 24, 21), 'miss');
  assert.equal(gradePick(pick({ type: 'ml', label: 'DEN ML' }), 17, 20), 'hit');
});

test('pickTeams describes the matchup from the backed team', () => {
  assert.deepEqual(pickTeams(pick()), { team: 'KC', away: 'KC', home: 'DEN', vs: '@ DEN' });
  assert.equal(pickTeams(pick({ label: 'DEN +3.5' })).vs, 'vs KC');
  assert.equal(pickTeams(pick({ type: 'total', label: 'Over 44.5' })).team, null);
});

test('legs saved with team, line, and side grade from those fields', () => {
  const opt = { key: 'm2:no', gameId: 'g1', type: 'spread', label: 'DEN +3.5', team: 'DEN', line: 3.5, price: 48, fair: 0.49 };
  const saved = pickFrom(opt, { matchup: 'KC @ DEN', start: now + HOUR }, now);
  assert.deepEqual([saved.team, saved.line, saved.side], ['DEN', 3.5, undefined]);
  assert.equal(gradePick(saved, 23, 20), 'hit');
  // The fields win over the label.
  assert.equal(gradePick({ ...saved, label: 'garbled' }, 23, 20), 'hit');
  const over = pickFrom({ key: 'm3:yes', gameId: 'g1', type: 'total', label: 'Over 44.5', line: 44.5, side: 'over', price: 50 }, { matchup: 'KC @ DEN', start: now }, now);
  assert.equal(gradePick({ ...over, label: '?' }, 24, 21), 'hit');
  assert.equal(pickTeams({ ...saved, label: '?' }).vs, 'vs KC');
});
