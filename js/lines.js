const DAY = 24 * 60 * 60 * 1000;

// NFL weeks run Thursday through Monday. Roll over Tuesday 10:00 UTC (early morning ET).
export function weekWindowAt(now = Date.now()) {
  const d = new Date(now);
  const daysSinceTuesday = (d.getUTCDay() - 2 + 7) % 7;
  let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10) - daysSinceTuesday * DAY;
  if (start > now) start -= 7 * DAY;
  return { start, end: start + 7 * DAY };
}

// Prices are cents (1-99) on a $1 contract.
export function americanOdds(price) {
  if (!(price > 0 && price < 100)) return '—';
  return price >= 50 ? `-${Math.round((100 * price) / (100 - price))}` : `+${Math.round((100 * (100 - price)) / price)}`;
}

export function multiplierToAmerican(mult) {
  if (!(mult > 1)) return '—';
  return mult >= 2 ? `+${Math.round((mult - 1) * 100)}` : `-${Math.round(100 / (mult - 1))}`;
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

function option(game, type, market, side, label, extra = {}) {
  const price = side === 'yes' ? market.yes_ask : market.no_ask;
  // No-vig probability: the two asks add up to a bit over 100, so normalize them. With
  // one side missing there's nothing to normalize against; use the price as is.
  const quoted = (p) => p > 0 && p < 100;
  const book = quoted(market.yes_ask) && quoted(market.no_ask) ? market.yes_ask + market.no_ask : 100;
  return {
    key: `${market.market_id}:${side}`,
    gameId: game.id,
    type,
    label,
    price,
    fair: book > 0 ? price / book : price / 100,
    available: market.status === 'active' && price > 0 && price < 100,
    ...extra,
  };
}

// A spread market reads "PIT wins by over 3.5". YES = PIT -3.5, NO = CLE +3.5.
function spreadOptions(game, market) {
  const team = market.subject_id;
  const other = team === game.home ? game.away : game.home;
  const line = -Math.abs(Number(market.line));
  return [
    option(game, 'spread', market, 'yes', `${team} ${signed(line)}`, { team, line }),
    option(game, 'spread', market, 'no', `${other} ${signed(-line)}`, { team: other, line: -line }),
  ];
}

// A total market reads "Over 38.5 points". YES = over, NO = under.
function totalOptions(game, market) {
  const line = Number(market.line);
  return {
    line,
    over: option(game, 'total', market, 'yes', `Over ${line}`, { line, side: 'over' }),
    under: option(game, 'total', market, 'no', `Under ${line}`, { line, side: 'under' }),
  };
}

const activeMarkets = (event) => (event?.markets ?? []).filter((m) => m.status === 'active');

/**
 * Turns lobby items plus full spread/total events into game cards for one week.
 * `details` maps event_id -> full event (with every alternate line).
 */
export function buildGames(lobby, details, window, now = Date.now()) {
  const games = [];
  for (const item of lobby) {
    const ev = item.primary_event ?? item;
    if (ev.sport !== 'nfl' || ev.market_type !== 'moneyline') continue;
    const start = ev.expected_start_time;
    if (!(start >= window.start && start < window.end)) continue;

    const dd = details.get(ev.event_id)?.display_data ?? ev.display_data ?? {};
    const game = {
      id: ev.event_id,
      start,
      away: dd.away_id,
      home: dd.home_id,
      matchup: `${dd.away_id} @ ${dd.home_id}`,
      locked: now >= start || (dd.game_status && dd.game_status !== 'pre_game'),
      relatedIds: [],
    };

    const mlEvent = details.get(ev.event_id) ?? ev;
    const mlMarkets = activeMarkets(mlEvent);
    game.ml = [game.away, game.home].map((team) => {
      const m = mlMarkets.find((x) => x.subject_id === team);
      return m ? option(game, 'ml', m, 'yes', `${team} ML`, { team }) : null;
    });

    const related = item.related_events ?? [];
    const spreadLobby = related.find((r) => r.market_type === 'spread');
    const totalLobby = related.find((r) => r.market_type === 'total');

    // Each spread/total market is one rung: a pair of opposite sides at one line.
    // Spread rungs run from "away favored by a lot" to "home favored by a lot",
    // so swiping left/right in the UI moves toward the away/home side.
    if (spreadLobby) {
      game.relatedIds.push(spreadLobby.event_id);
      const full = details.get(spreadLobby.event_id) ?? spreadLobby;
      const mainId = spreadLobby.markets?.[0]?.market_id;
      const rungs = activeMarkets(full)
        .map((m) => {
          const pair = spreadOptions(game, m);
          const home = pair.find((o) => o.team === game.home);
          const away = pair.find((o) => o.team === game.away);
          return { away, home, homeLine: home?.line, main: m.market_id === mainId };
        })
        .filter((r) => r.away && r.home) // a market naming neither team is skipped
        .sort((a, b) => b.homeLine - a.homeLine);
      game.spread = { rungs, mainIndex: Math.max(0, rungs.findIndex((r) => r.main)) };
    }

    if (totalLobby) {
      game.relatedIds.push(totalLobby.event_id);
      const full = details.get(totalLobby.event_id) ?? totalLobby;
      const mainId = totalLobby.markets?.[0]?.market_id;
      const rungs = activeMarkets(full)
        .map((m) => ({ ...totalOptions(game, m), main: m.market_id === mainId }))
        .sort((a, b) => a.line - b.line);
      game.total = { rungs, mainIndex: Math.max(0, rungs.findIndex((r) => r.main)) };
    }

    games.push(game);
  }
  return games.sort((a, b) => a.start - b.start || a.matchup.localeCompare(b.matchup));
}

export function indexOptions(games) {
  const index = new Map();
  const add = (o) => o && index.set(o.key, o);
  for (const g of games) {
    g.ml.forEach(add);
    g.spread?.rungs.forEach((r) => (add(r.away), add(r.home)));
    g.total?.rungs.forEach((r) => (add(r.over), add(r.under)));
  }
  return index;
}

// A spread/total column's key, for the line it shows (state.rungs).
export const ladderKey = (game, type) => `${game.id}:${type}`;

// Spread: away team on top. Total: over on top (sportsbook convention).
export function ladderSides(game, type, index) {
  const rung = game[type].rungs[index];
  return type === 'spread' ? [rung.away, rung.home] : [rung.over, rung.under];
}

// No-vig win chance for the away team, from the two moneylines' fair chances.
export function awayWinPct(game) {
  const [away, home] = game.ml;
  if (!away?.fair || !home?.fair) return null;
  return Math.round((100 * away.fair) / (away.fair + home.fair));
}
