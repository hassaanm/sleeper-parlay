// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addStats, buildLeague, commonOpponents, headToHead, recordOf, resume, winChains } from '../js/research.js';

const r = (week, away, awayScore, home, homeScore) => ({ week, away, awayScore, home, homeScore });

// An AFC East season, out of order. BUF goes W W T L W W W.
const afc = () => buildLeague([
  r(7, 'MIA', 14, 'BUF', 28),
  r(4, 'BUF', 27, 'MIA', 30),
  r(1, 'MIA', 10, 'BUF', 24),
  r(2, 'BUF', 20, 'NE', 17),
  r(3, 'NYJ', 13, 'BUF', 13),
  r(5, 'NE', 3, 'BUF', 31),
  r(6, 'BUF', 21, 'NYJ', 10),
]);

test('buildLeague gives each team its games oldest first, from its own side', () => {
  const buf = afc().teams.get('BUF');
  assert.deepEqual(buf.games.map((g) => g.week), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(buf.games[0], { week: 1, opp: 'MIA', home: true, pf: 24, pa: 10, result: 'W' });
  assert.deepEqual(buf.games[3], { week: 4, opp: 'MIA', home: false, pf: 27, pa: 30, result: 'L' });
});

test('records count ties, overall and split home and road', () => {
  const league = afc();
  const buf = league.teams.get('BUF');
  assert.deepEqual([buf.gp, buf.wins, buf.losses, buf.ties], [7, 5, 1, 1]);
  assert.deepEqual([buf.record, buf.homeRecord, buf.roadRecord], ['5-1-1', '3-0-1', '2-1']);
  assert.equal(league.teams.get('NYJ').record, '0-1-1');
  assert.equal(league.size, 4);
  assert.equal(recordOf([]), '0-0');
});

test('last five, streak, and points', () => {
  const { teams } = afc();
  const buf = teams.get('BUF');
  assert.deepEqual(buf.lastFive.map((g) => g.result).join(''), 'TLWWW');
  assert.equal(buf.streak, 'W3');
  assert.equal(teams.get('NE').streak, 'L2');
  assert.equal(buildLeague([r(1, 'NYJ', 13, 'BUF', 13)]).teams.get('NYJ').streak, 'T1');
  assert.deepEqual([buf.pointsFor, buf.pointsAgainst, buf.pointDiff], [164, 97, 67]);
});

test('division standing breaks a win-percentage tie on point differential', () => {
  const { teams } = afc();
  assert.equal(teams.get('BUF').standing, '1st in AFC East');
  assert.equal(teams.get('MIA').standing, '2nd in AFC East');
  // NE (0-2) and NYJ (0-1-1) both win 0%; NYJ is -11, NE is -31.
  assert.equal(teams.get('NYJ').standing, '3rd in AFC East');
  assert.equal(teams.get('NE').standing, '4th in AFC East');
});

test('resume counts the record against winning teams and the last three', () => {
  const league = afc();
  const ne = resume(league, 'NE'); // both games against 5-1-1 BUF
  assert.deepEqual([ne.vsWinning, ne.last3, ne.home, ne.road, ne.margin], ['0-2', '0-2', '0-1', '0-1', -15.5]);
  assert.equal(resume(league, 'BUF').vsWinning, '0-0'); // no AFC East rival has a winning record
  assert.equal(resume(league, 'KC'), null);
});

// BUF beat NE, NE beat BAL, BAL beat KC, BUF beat KC, KC beat DEN.
const chains = () => buildLeague([
  r(1, 'NE', 10, 'BUF', 20),
  r(2, 'NE', 17, 'BAL', 14),
  r(3, 'KC', 20, 'BAL', 27),
  r(4, 'BUF', 27, 'KC', 20),
  r(5, 'DEN', 10, 'KC', 30),
]);

test('winChains follows wins only, shortest first, up to maxHops links', () => {
  const league = chains();
  const toKc = winChains(league, 'BUF', 'KC');
  assert.deepEqual(toKc.map((c) => c.map((l) => `${l.winner}>${l.loser}`).join(' ')), ['BUF>KC', 'BUF>NE NE>BAL BAL>KC']);
  assert.deepEqual(toKc[0], [{ winner: 'BUF', loser: 'KC', score: '27-20', week: 4 }]);
  assert.deepEqual(winChains(league, 'BUF', 'DEN').map((c) => c.length), [2]); // BUF>NE>BAL>KC>DEN is 4 links
  assert.deepEqual(winChains(league, 'BUF', 'DEN', 4).map((c) => c.length), [2, 4]);
  assert.deepEqual(winChains(league, 'KC', 'BUF'), []);
});

test('commonOpponents lists shared opponents with each side\'s games against them', () => {
  const league = chains();
  const common = commonOpponents(league, 'BUF', 'BAL');
  assert.deepEqual(common.map((c) => [c.opp, c.a.map((g) => g.week), c.b.map((g) => g.week)]), [['NE', [1], [2]], ['KC', [4], [3]]]);
  assert.equal(common[0].a[0].result, 'W'); // from BUF's side
  assert.deepEqual(commonOpponents(league, 'BUF', 'SEA'), []);
  assert.deepEqual(headToHead(league, 'BUF', 'KC').map((g) => g.week), [4]);
});

// Three teams, one round robin. Each TEAM row is one offense's game.
const statsLeague = () => addStats(buildLeague([r(1, 'MIA', 10, 'BUF', 24), r(2, 'NE', 13, 'MIA', 20), r(3, 'BUF', 17, 'NE', 21)]), {
  games: [
    { team: 'BUF', opponent: 'MIA', stats: { pass_yd: 300, pass_sack_yds: 20, rush_yd: 120, pass_sack: 2 } }, // 400 net yards
    { team: 'MIA', opponent: 'BUF', stats: { pass_yd: 200, rush_yd: 80 } }, // 280
    { team: 'MIA', opponent: 'NE', stats: { pass_yd: 100, rush_yd: 50 } }, // 150
    { team: 'NE', opponent: 'MIA', stats: { pass_yd: 150, rush_yd: 50 } }, // 200
    { team: 'NE', opponent: 'BUF', stats: { pass_yd: 180, rush_yd: 70 } }, // 250
    { team: 'BUF', opponent: 'NE', stats: { pass_yd: 200, rush_yd: 50 } }, // 250
  ],
});

test('addStats ranks offense high-to-low and defense low-to-high', () => {
  const { teams } = statsLeague();
  const [buf, mia, ne] = ['BUF', 'MIA', 'NE'].map((a) => teams.get(a));
  assert.deepEqual([buf.per.yards, ne.per.yards, mia.per.yards], [325, 225, 215]); // sack yards come off passing
  assert.deepEqual([buf.ranks.yards, ne.ranks.yards, mia.ranks.yards], [1, 2, 3]);
  assert.deepEqual([ne.per.yardsAllowed, buf.per.yardsAllowed, mia.per.yardsAllowed], [200, 265, 300]);
  assert.deepEqual([ne.ranks.yardsAllowed, buf.ranks.yardsAllowed, mia.ranks.yardsAllowed], [1, 2, 3]); // fewest allowed ranks 1
  assert.equal(mia.per.sacks, 2); // BUF was sacked twice against MIA
  assert.equal(mia.ranks.sacks, 1);
});

test('starters skip unavailable players and follow trades', () => {
  const p = (id, position, stats, player = {}) => ({ player_id: id, team: 'BUF', player: { position, team: 'BUF', ...player }, stats });
  const league = buildLeague([r(1, 'MIA', 10, 'BUF', 24)]);
  addStats(league, {
    games: [],
    players: [
      p('qb-backup', 'QB', { gs: 1, pass_att: 300 }),
      p('qb', 'QB', { gs: 7, pass_att: 200 }), // starts beat attempts
      p('rb-out', 'RB', { rush_att: 100, rec_tgt: 20 }, { injury_status: 'Out' }),
      p('rb', 'RB', { rush_att: 60, rec_tgt: 10 }),
      p('wr1', 'WR', { rec_tgt: 50 }, { injury_status: 'Questionable' }),
      p('wr2', 'WR', { rec_tgt: 40 }),
      p('wr3', 'WR', { rec_tgt: 30 }),
      p('wr4', 'WR', { rec_tgt: 20 }),
      p('traded', 'WR', { rec_tgt: 90 }, { team: 'MIA' }), // his BUF stats, but he plays for MIA now
      p('te', 'TE', { rec_tgt: 25 }),
    ],
  });
  assert.deepEqual(league.teams.get('BUF').starters.map((s) => s.player_id), ['qb', 'rb', 'wr1', 'wr2', 'wr3', 'te']);
  assert.deepEqual(league.teams.get('MIA').starters.map((s) => s.player_id), ['traded']);
});
