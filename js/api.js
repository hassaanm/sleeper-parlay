// Public Sleeper endpoints (no auth, CORS open).
const BASE = 'https://api.sleeper.app';

export async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper request failed (${res.status})`);
  return res.json();
}

export const fetchNflState = () => getJson(`${BASE}/v1/state/nfl`);
export const fetchLeague = (leagueId) => getJson(`${BASE}/v1/league/${encodeURIComponent(leagueId)}`);
export const fetchLeagueUsers = (leagueId) => getJson(`${BASE}/v1/league/${encodeURIComponent(leagueId)}/users`);

// Lobby items are { primary_event, related_events } where the primary event is the
// moneyline and related events carry the main spread/total market only.
export const fetchLobby = () => getJson(`${BASE}/predictions/events/lobby`);

// Full events, including every alternate spread/total line.
export async function fetchEvents(ids) {
  if (!ids.length) return [];
  return getJson(`${BASE}/predictions/events?ids=${ids.map(encodeURIComponent).join(',')}`);
}

// Season-to-date stats from Sleeper, through `week`: one row per player (QB/RB/WR/TE),
// one per team defense, and one per team per game (the "TEAM" rows, which name the
// opponent, so yards allowed can be split into passing and rushing). About 2.5 MB, so
// only fetched when someone opens a research page.
const STATS = 'https://api.sleeper.com/stats/nfl';
export async function fetchSeasonStats(season, week) {
  const query = (positions) => `season_type=regular&${positions.map((p) => `position[]=${p}`).join('&')}`;
  const [offense, defense, ...games] = await Promise.all([
    getJson(`${STATS}/${season}?${query(['QB', 'RB', 'WR', 'TE'])}`),
    getJson(`${STATS}/${season}?${query(['DEF'])}`),
    ...Array.from({ length: week }, (_, i) => getJson(`${STATS}/${season}/${i + 1}?${query(['TEAM'])}`).catch(() => [])),
  ]);
  return { offense, defense, games: games.flat() };
}

export const playerHeadshot = (playerId) => `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;

export const avatarUrl = (avatarId) => (avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : null);
export const teamLogo = (abbr) => `https://sleepercdn.com/images/team_logos/nfl/${String(abbr).toLowerCase()}.png`;

// Prefer the custom team avatar, fall back to the user's profile picture.
export function memberFromUser(user) {
  const meta = user.metadata ?? {};
  const teamAvatar = meta.avatar && !meta.avatar.includes('avatar_default') ? meta.avatar : null;
  return {
    id: user.user_id,
    name: user.display_name,
    teamName: meta.team_name || null,
    avatar: teamAvatar ?? avatarUrl(user.avatar),
  };
}
