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

// Season-to-date stats from Sleeper: one row per player (QB/RB/WR/TE) and one per team
// defense. Large (~2 MB), so only fetched when someone opens a research page.
const SEASON_STATS = 'https://api.sleeper.com/stats/nfl';
export async function fetchSeasonStats(season) {
  const get = (positions) => getJson(`${SEASON_STATS}/${season}?season_type=regular&${positions.map((p) => `position[]=${p}`).join('&')}`);
  const [offense, defense] = await Promise.all([get(['QB', 'RB', 'WR', 'TE']), get(['DEF'])]);
  return { offense, defense };
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
