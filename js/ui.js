// Shared markup helpers for the views: escaping, number and date formats, avatars,
// logos, icons, TV and weather badges. Each returns an HTML string.
import * as api from './api.js';
import { americanOdds } from './lines.js';
import { state } from './state.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
export const shortDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
export const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const dayTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export const fmtOdds = (price) => (state.oddsFormat === 'pct' ? (price > 0 && price < 100 ? `${price}%` : '—') : americanOdds(price));

// Typographic minus for line labels like "JAX -7.5".
export const pretty = (label) => String(label ?? '').replace(/ -(?=\d)/, ' −');

export function avatar(member, size = 32, extraClass = '') {
  const style = `width:${size}px;height:${size}px`;
  if (member?.avatar) return `<img class="avatar ${extraClass}" style="${style}" src="${esc(member.avatar)}" alt="" loading="lazy">`;
  const initials = (member?.name ?? '?').slice(0, 2).toUpperCase();
  return `<span class="avatar avatar-fallback ${extraClass}" style="${style};font-size:${Math.round(size * 0.38)}px">${esc(initials)}</span>`;
}

export function teamLogo(abbr, size = 32) {
  return `<img class="logo" style="width:${size}px;height:${size}px" src="${esc(api.teamLogo(abbr))}" alt="${esc(abbr)}" loading="lazy">`;
}

export const LOCK_ICON =
  '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

export const fmtLine = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

// Leading +/− drawn lighter and slimmer than the digits, so numbers scan by size.
export const signSpan = (text) => String(text).replace(/^([+−-])/, '<span class="sign">$1</span>');

export function weatherIcon(text = '') {
  const t = text.toLowerCase();
  if (t.includes('thunder')) return '⛈️';
  if (t.includes('snow') || t.includes('flurr')) return '🌨️';
  if (t.includes('rain') || t.includes('shower') || t.includes('drizzle')) return '🌧️';
  if (t.includes('fog') || t.includes('haze')) return '🌫️';
  if (t.includes('wind')) return '💨';
  if (['partly', 'mostly sunny', 'intermittent', 'scattered', 'few', 'broken'].some((w) => t.includes(w))) return '⛅';
  if (t.includes('cloud') || t.includes('overcast')) return '☁️';
  return '☀️';
}

// TV networks (Sleeper's channel codes: CBS, FOX, NBC/Peacock, ESPN, ABC, AMZN, NFLN).
// Real logos where a free source has them: NBC's color peacock from
// Wikimedia Commons; CBS, FOX (in gold), Netflix, YouTube from Simple Icons. ESPN,
// ABC, and Prime Video get badges in their brand colors. Unknown networks are text.
const WIKI = 'https://upload.wikimedia.org/wikipedia/commons';
const NETWORKS = [
  [/^cbs/, 'CBS', { src: 'https://cdn.simpleicons.org/cbs/ffffff', label: 'CBS' }],
  // The NBC file has black "NBC" letters under the peacock; show only the peacock.
  [/^nbc/, 'NBC', { src: `${WIKI}/3/3f/NBC_logo.svg`, label: 'NBC', crop: 'nbc' }],
  [/^fox/, 'FOX', { src: 'https://cdn.simpleicons.org/fox/f5c542', crop: 'fox' }],
  [/netflix/, 'Netflix', { src: 'https://cdn.simpleicons.org/netflix' }],
  [/youtube/, 'YouTube', { src: 'https://cdn.simpleicons.org/youtube', label: 'YouTube' }],
  [/^espn/, 'ESPN', { badge: 'espn' }],
  [/^abc/, 'abc', { badge: 'abc' }],
  [/prime|amzn|amazon/, 'prime video', { badge: 'prime' }],
  [/^nfl ?n/, 'NFL Network', { badge: 'nfln' }],
  [/peacock/, 'Peacock', { badge: 'peacock' }],
];

export function tvBadges(tv) {
  const names = tv.split(/[/,]/).map((name) => name.trim()).filter(Boolean);
  // NBC games also stream on Peacock; the NBC badge alone says enough.
  const hasNbc = names.some((name) => /^nbc$/i.test(name));
  return names.filter((name) => !(hasNbc && /peacock/i.test(name))).map((name) => {
    const match = NETWORKS.find(([re]) => re.test(name.toLowerCase()));
    if (!match) return `<span class="tv">${esc(name)}</span>`;
    const [, title, how] = match;
    if (how.src) {
      return `<span class="tv-logo ${how.crop ? `tv-crop-${how.crop}` : ''}" title="${esc(title)}"><span class="tv-img"><img src="${how.src}" alt="${esc(title)}"></span>${how.label ? esc(how.label) : ''}</span>`;
    }
    return `<span class="tv tv-${how.badge}">${esc(title)}</span>`;
  }).join('');
}

// Tiny deterministic random (FNV-1a hash into xorshift): same input, same numbers.
export function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

export const fmt1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : '—');
export const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;

// Rank tiers: top quarter of the league reads green, bottom quarter red.
export function rankTier(rank, size) {
  if (!rank) return '';
  if (rank <= Math.ceil(size / 4)) return 'top';
  if (rank > size - Math.ceil(size / 4)) return 'bottom';
  return '';
}

// A league rank, everywhere it shows: quiet text reading "5th", beside its number.
export const rankText = (rank) => `<small class="rk">${rank ? ordinal(rank) : '—'}</small>`;

// A game result, everywhere it shows: a W, L, or T chip.
export const resultChip = (result) => `<span class="res-chip ${result}">${result}</span>`;

// Green for a positive number, red for a negative one (point diff, margins).
export const toneOf = (n) => (n > 0 ? 'good' : n < 0 ? 'bad' : '');

// Stat formats: whole percents ("41%") and signed counts ("+3", "−2").
export const fmtPct = (n) => (Number.isFinite(n) ? `${Math.round(n)}%` : '—');
export const fmtSigned = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export const chevronSmall = () =>
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

export const chevron = (dir) =>
  `<svg class="chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${{ up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', left: 'M15 6l-6 6 6 6' }[dir]}"/></svg>`;
