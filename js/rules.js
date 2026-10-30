// The pool's rules as pure functions of a slip and the time: when picks lock, which
// legs clash, and how a leg grades against a score. No state, DOM, or network, so
// `node --test` can check them (see tests/).

// Picks lock when the admin locks them by hand or when the deadline (settings.cutoff)
// passes. Games that kick off before the deadline can't be picked: the parlay only
// covers games that start after everyone is in.
export const slipLocked = (slip, now = Date.now()) =>
  !!slip?.settings?.locked || (!!slip?.settings?.cutoff && now >= slip.settings.cutoff);
export const startsBeforeCutoff = (slip, start) => !!slip?.settings?.cutoff && start < slip.settings.cutoff;

// Why a member can't change or remove their leg right now, or null if they can. Once a
// leg's game kicks off it's locked in, so nobody swaps out of a leg that's losing.
export function legLockedReason(slip, userId, now = Date.now()) {
  if (slipLocked(slip, now)) return 'Picks are locked for this week.';
  const mine = slip?.picks?.[userId];
  if (mine && mine.start <= now) return 'Your leg’s game has started, so it’s locked in.';
  return null;
}

// Why a member can't take a leg in a game starting at `start`, or null if they can.
// The admin, picking for someone, may change a locked leg but still can't pick a game
// that has started or starts before the deadline. Conflicts with other members' legs
// are checked separately (clashFor).
export function pickBlockedReason(slip, userId, start, { admin = false, now = Date.now() } = {}) {
  return (admin ? null : legLockedReason(slip, userId, now))
    ?? (startsBeforeCutoff(slip, start) ? 'That game starts before picks lock.' : null)
    ?? (start <= now ? 'That game has started.' : null);
}

// Moneyline and spread share one slot per game: a favorite's spread with the other
// team's moneyline can never both hit, and the rest just double up on the same side.
// Totals are independent.
const slotOf = (type) => (type === 'total' ? 'total' : 'side');

// Who already holds a conflicting leg: one moneyline-or-spread and one total per game
// (or one leg per game when the slip's blockSameGame setting is on).
export function clashFor(slip, userId, opt) {
  for (const [uid, pick] of Object.entries(slip.picks ?? {})) {
    if (uid === userId || pick.gameId !== opt.gameId) continue;
    if (slip.settings?.blockSameGame || slotOf(pick.type) === slotOf(opt.type)) return { userId: uid, pick };
  }
  return null;
}

// A saved leg, from a line option and its game. The label is for display; grading reads
// the team (moneyline, spread), line (spread, total), and side (total: over or under).
export function pickFrom(opt, game, now = Date.now()) {
  return {
    optKey: opt.key,
    gameId: opt.gameId,
    type: opt.type,
    label: opt.label,
    matchup: game.matchup,
    ...(opt.team ? { team: opt.team } : {}),
    ...(opt.line != null ? { line: opt.line } : {}),
    ...(opt.side ? { side: opt.side } : {}),
    price: opt.price,
    fair: opt.fair,
    start: game.start,
    pickedAt: now,
  };
}

// Grade a pick against a score: 'hit', 'miss', or 'push'. Used for finals, and for
// "covering right now" while a game is live.
export function gradePick(pick, awayScore, homeScore) {
  const [away] = pick.matchup.split(' @ ');
  let margin;
  if (pick.type === 'total') {
    const total = awayScore + homeScore;
    margin = pick.side === 'over' ? total - pick.line : pick.line - total;
  } else {
    const mine = pick.team === away ? awayScore : homeScore;
    const theirs = pick.team === away ? homeScore : awayScore;
    margin = mine + (pick.type === 'spread' ? pick.line : 0) - theirs;
  }
  return margin > 0 ? 'hit' : margin < 0 ? 'miss' : 'push';
}

// Which team a pick backs, and how to describe the matchup from that team's side.
export function pickTeams(pick) {
  const [away, home] = pick.matchup.split(' @ ');
  if (pick.type === 'total') return { team: null, away, home, vs: `${away} @ ${home}` };
  return { team: pick.team, away, home, vs: pick.team === away ? `@ ${home}` : `vs ${away}` };
}

// One key for a game across Sleeper's scores and the lines: "AWAY@HOME".
export const gameKey = (away, home) => `${away}@${home}`;
