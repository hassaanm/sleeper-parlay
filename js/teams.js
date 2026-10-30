// The 32 teams: names, divisions, and colors.

// Hand-picked team colors, tuned to read well on the app's dark background: every
// color sits in a similar brightness band so no team looks faded next to another.
// Dark official colors (navy, midnight green) are brightened; the hue stays true.
// [primary, alternate]
export const TEAM_COLORS = {
  ARI: ['#D2223E', '#FFB612'],
  ATL: ['#E0283F', '#B5BCC2'],
  BAL: ['#7A4FD6', '#D4A82C'],
  BUF: ['#2F6FE0', '#E0283F'],
  CAR: ['#1E9BE0', '#B5BCC2'],
  CHI: ['#3E63C2', '#F26B2E'],
  CIN: ['#FB5A1E', '#B5BCC2'],
  CLE: ['#FF5A1F', '#A0703F'],
  DAL: ['#2F6FE0', '#B5BCC2'],
  DEN: ['#FB5A1E', '#3E63C2'],
  DET: ['#1E8FD6', '#B5BCC2'],
  GB: ['#2E9A5C', '#FFB612'],
  HOU: ['#3E5FC2', '#E0283F'],
  IND: ['#2F6FE0', '#B5BCC2'],
  JAX: ['#13A0B0', '#D7A22A'],
  KC: ['#E8263F', '#FFB81C'],
  LV: ['#B5BCC2', '#6E777D'],
  LAC: ['#2AA3E8', '#FFC20E'],
  LAR: ['#3366E6', '#FFD100'],
  MIA: ['#15AAB3', '#FC6A1E'],
  MIN: ['#7F4FD0', '#FFC62F'],
  NE: ['#3E5FC2', '#D6283F'],
  NO: ['#D3BC8D', '#B5BCC2'],
  NYG: ['#3360D6', '#D6283F'],
  NYJ: ['#22A06A', '#B5BCC2'],
  PHI: ['#1A9098', '#B5BCC2'],
  PIT: ['#FFB612', '#B5BCC2'],
  SF: ['#D6283A', '#C2A465'],
  SEA: ['#3B63B8', '#69BE28'],
  TB: ['#E0242B', '#A39B91'],
  TEN: ['#4B9BE6', '#D6283F'],
  WAS: ['#B52C45', '#FFB612'],
};

export const TEAM_NAMES = {
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
export const divisionOf = (abbr) => Object.keys(DIVISIONS).find((d) => DIVISIONS[d].includes(abbr));
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
 * Colors for a matchup. Home always gets its primary. Away gets its primary too,
 * unless the two read as the same (hues within 28 degrees, like red vs red); then away
 * takes whichever of its colors stands apart more.
 */
export function matchupColors(away, home) {
  const [awayPrimary, awayAlt] = TEAM_COLORS[away] ?? FALLBACK;
  const [homePrimary] = TEAM_COLORS[home] ?? FALLBACK;
  if (distance(awayPrimary, homePrimary) >= 28) return { away: awayPrimary, home: homePrimary };
  const awayColor = distance(awayAlt, homePrimary) > distance(awayPrimary, homePrimary) ? awayAlt : awayPrimary;
  return { away: awayColor, home: homePrimary };
}
