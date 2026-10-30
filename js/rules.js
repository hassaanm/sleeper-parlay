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

// Who already holds a conflicting leg: one leg per game + bet type (or one per game
// when the slip's blockSameGame setting is on).
export function clashFor(slip, userId, opt) {
  for (const [uid, pick] of Object.entries(slip.picks ?? {})) {
    if (uid === userId || pick.gameId !== opt.gameId) continue;
    if (slip.settings?.blockSameGame || pick.type === opt.type) return { userId: uid, pick };
  }
  return null;
}

// Grade a pick against a score: 'hit', 'miss', or 'push'. Used for finals, and for
// "covering right now" while a game is live.
export function gradePick(pick, awayScore, homeScore) {
  const [away] = pick.matchup.split(' @ ');
  const [first, rest] = pick.label.split(' ');
  let margin;
  if (pick.type === 'total') {
    const line = Number(rest);
    margin = first === 'Over' ? awayScore + homeScore - line : line - (awayScore + homeScore);
  } else {
    const mine = first === away ? awayScore : homeScore;
    const theirs = first === away ? homeScore : awayScore;
    const line = pick.type === 'spread' ? Number(String(rest).replace('−', '-')) : 0;
    margin = mine + line - theirs;
  }
  return margin > 0 ? 'hit' : margin < 0 ? 'miss' : 'push';
}

// Which team a pick backs, and how to describe the matchup from that team's side.
export function pickTeams(pick) {
  const [away, home] = pick.matchup.split(' @ ');
  if (pick.type === 'total') return { team: null, away, home, vs: `${away} @ ${home}` };
  const team = pick.label.split(' ')[0];
  return { team, away, home, vs: team === away ? `@ ${home}` : `vs ${away}` };
}

// One key for a game across Sleeper's scores and the lines: "AWAY@HOME".
export const gameKey = (away, home) => `${away}@${home}`;
