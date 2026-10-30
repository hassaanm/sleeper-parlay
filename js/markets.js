// Prices for games that have kicked off, from each game's prediction events (the
// scoreboard lists them, even after the lobby drops a finished game): live prices
// while a game is on, and for a finished game, every line's price at kickoff plus the
// away team's win chance through the game.
import { getJson } from './api.js';

const EVENTS = 'https://api.sleeper.app/predictions/events';

// One game's lines from its events: the two moneylines, and every spread and total
// line. `price(market, 'yes' | 'no')` gives a market's price on that side, or null.
function linesFrom(events, game, price) {
  const of = (type) => events.find((e) => e.market_type === type)?.markets ?? [];
  const ml = {};
  for (const m of of('moneyline')) {
    if (m.subject_id === game.away) ml.away = price(m, 'yes');
    if (m.subject_id === game.home) ml.home = price(m, 'yes');
  }
  // A spread market reads "PIT wins by over 3.5": YES is PIT −3.5, NO the other side.
  const spreads = of('spread')
    .filter((m) => m.subject_id === game.away || m.subject_id === game.home)
    .map((m) => {
      const awayFav = m.subject_id === game.away;
      const line = Math.abs(Number(m.line));
      return { id: m.market_id, awayLine: awayFav ? -line : line, away: price(m, awayFav ? 'yes' : 'no'), home: price(m, awayFav ? 'no' : 'yes') };
    })
    .filter((r) => r.away != null && r.home != null);
  const totals = of('total')
    .map((m) => ({ id: m.market_id, line: Number(m.line), over: price(m, 'yes'), under: price(m, 'no') }))
    .filter((r) => r.over != null && r.under != null);
  return { ml, spreads, totals };
}

const quoted = (p) => (p > 0 && p < 100 ? p : null);

/** Live lines for games underway, keyed "AWAY@HOME". One request for all of them. */
export async function livePrices(games) {
  const ids = games.flatMap((g) => g.eventIds);
  if (!ids.length) return new Map();
  const events = await getJson(`${EVENTS}?ids=${ids.map(encodeURIComponent).join(',')}`);
  const live = (m, side) => (m.status === 'active' ? quoted(side === 'yes' ? m.yes_ask : m.no_ask) : null);
  return new Map(games.map((g) => [g.key, linesFrom(events.filter((e) => g.eventIds.includes(e.event_id)), g, live)]));
}

/**
 * A finished game's lines at kickoff (each market's last trade price then), and
 * `momentum`: the away team's win chance from kickoff to the end, in 49 steps.
 */
export async function kickoffPrices(game) {
  const events = (await getJson(`${EVENTS}?ids=${game.eventIds.map(encodeURIComponent).join(',')}`))
    .filter((e) => ['moneyline', 'spread', 'total'].includes(e.market_type));
  // Minute-by-minute prices from half an hour before kickoff, per market ticker. Each
  // point closes a run of minutes at one price, so the price at time t is the first
  // point ending at or after t.
  const since = game.start - 30 * 60_000;
  const histories = await Promise.all(events.map((e) => getJson(`${EVENTS}/${e.event_id}/history?start_time=${since}`)));
  const series = new Map(histories.flatMap((h) => (h.markets ?? []).map((m) => [m.ticker, m.history ?? []])));
  const at = (points, t) => (points.find((p) => p.end_time >= t) ?? points.at(-1))?.price;
  const lines = linesFrom(events, game, (m, side) => {
    const yes = quoted(at(series.get(m.provider_id) ?? [], game.start));
    return yes == null ? null : side === 'yes' ? yes : 100 - yes;
  });
  const awayTicker = events.find((e) => e.market_type === 'moneyline')?.markets.find((m) => m.subject_id === game.away)?.provider_id;
  const points = (series.get(awayTicker) ?? []).filter((p) => p.end_time >= game.start);
  const end = points.find((p) => p.price <= 1 || p.price >= 99)?.end_time ?? points.at(-1)?.end_time;
  lines.momentum = points.length && end > game.start
    ? Array.from({ length: 49 }, (_, i) => at(points, game.start + ((end - game.start) * i) / 48))
    : null;
  return lines;
}
