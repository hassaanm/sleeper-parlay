// The 32 teams: names, divisions, and colors.

// Team colors, picked from each team's Sleeper logo so a bar or chart in that color
// reads as that team at a glance: [the color you see most in the logo, another one
// from it]. Tuned for the app's dark background (dark navies and greens brightened,
// oranges pushed far enough from reds to tell apart in a thin bar).
const TEAM_COLORS = {
  ARI: ['#D2223E', '#FFB612'],
  ATL: ['#E0283F', '#B5BCC2'],
  BAL: ['#7A4FD6', '#D4A82C'],
  BUF: ['#2F6FE0', '#E0283F'],
  CAR: ['#1E9BE0', '#B5BCC2'],
  CHI: ['#FF7F22', '#3E63C2'],
  CIN: ['#FF7F22', '#B5BCC2'],
  CLE: ['#FF7F22', '#B07A47'],
  DAL: ['#2F6FE0', '#B5BCC2'],
  DEN: ['#FF7F22', '#3E63C2'],
  DET: ['#1E8FD6', '#B5BCC2'],
  GB: ['#2E9A5C', '#FFB612'],
  HOU: ['#E0283F', '#3E5FC2'],
  IND: ['#2F6FE0', '#B5BCC2'],
  JAX: ['#D7A22A', '#13A0B0'],
  KC: ['#E8263F', '#FFB81C'],
  LV: ['#B5BCC2', '#000000'],
  LAC: ['#2AA3E8', '#FFC20E'],
  LAR: ['#FFD100', '#3366E6'],
  MIA: ['#15AAB3', '#FC6A1E'],
  MIN: ['#7F4FD0', '#FFC62F'], // purple, though the logo shows more gold: it's how fans see them
  NE: ['#3D6BEF', '#B5BCC2'],
  NO: ['#D3BC8D', '#B5BCC2'],
  NYG: ['#3360D6', '#B5BCC2'],
  NYJ: ['#22A06A', '#B5BCC2'],
  PHI: ['#1A9098', '#B5BCC2'],
  PIT: ['#FFC21A', '#3E73C8'],
  SF: ['#D6283A', '#C2A465'],
  SEA: ['#3B63B8', '#69BE28'],
  TB: ['#E0242B', '#A39B91'],
  TEN: ['#6CB4EE', '#F2F4F7'],
  WAS: ['#B52C45', '#FFB612'],
};

const TEAM_NAMES = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SF: 'San Francisco 49ers',
  SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};

export const DIVISIONS = {
  'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'], 'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
  'AFC South': ['HOU', 'IND', 'JAX', 'TEN'], 'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
  'NFC East': ['DAL', 'NYG', 'PHI', 'WAS'], 'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
  'NFC South': ['ATL', 'CAR', 'NO', 'TB'], 'NFC West': ['ARI', 'LAR', 'SF', 'SEA'],
};
const divisionOf = (abbr) => Object.keys(DIVISIONS).find((d) => DIVISIONS[d].includes(abbr));
export const conferenceOf = (abbr) => divisionOf(abbr)?.slice(0, 3);

export const teamName = (abbr) => TEAM_NAMES[abbr] ?? abbr;
// "Kansas City Chiefs" -> "Chiefs".
export const nickname = (abbr) => teamName(abbr).split(' ').at(-1);
// A team's primary color, for its page's hero and top bar.
export const teamColor = (abbr) => TEAM_COLORS[abbr]?.[0] ?? '#4b5a85';

const FALLBACK = ['#8a96b8', '#5d6a90'];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

function hueSat(hex) {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.12) return { hue: null, sat: 0 }; // gray / silver
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (hue * 60 + 360) % 360, sat: d };
}

// How different two colors look in a thin bar: hue distance in degrees, with grays
// counted as far from any real color.
function distance(a, b) {
  const x = hueSat(a);
  const y = hueSat(b);
  if (x.hue === null || y.hue === null) return x.hue === y.hue ? 0 : 180;
  const diff = Math.abs(x.hue - y.hue);
  return Math.min(diff, 360 - diff);
}

/**
 * Colors for a matchup: each team's main color, unless the two read as the same (hues
 * within 28 degrees, like blue vs blue). Then the home team keeps its main color and
 * the away team switches to its second one.
 */
export function matchupColors(away, home) {
  const [awayMain, awayAlt] = TEAM_COLORS[away] ?? FALLBACK;
  const [homeMain] = TEAM_COLORS[home] ?? FALLBACK;
  return { away: distance(awayMain, homeMain) >= 28 ? awayMain : awayAlt, home: homeMain };
}
