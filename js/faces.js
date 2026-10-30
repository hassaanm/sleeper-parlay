// The slip's faces row (everyone with a leg) animates its changes after each render:
// faces that moved slide to their new spots, new faces pop in, and faces that left
// fall off the screen. Your own pick is one connected move: your sticker slaps onto the
// cell you tapped (board.js), then a copy peels off it and glides into your spot in
// the row, while your old face falls out and the others slide aside to make room.
//
// Everything moves inside the row, so each face keeps its place in the stack: over the
// face to its left, under the face to its right.
import { state } from './state.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const SLAP_MS = 420; // the sticker's slap (styles.css .sticker.slap), before the copy peels off
const GLIDE_MS = 680;
const SLIDE = { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
const GRAVITY = 2600; // px/s², for faces falling out of the row

// The faces row of whichever slip is showing: the phone slip and the desktop ticket
// are both in the page, and the hidden one measures as 0x0 at the top left.
const visibleRow = (root) => [...root.querySelectorAll('.slip-peek .faces')].find((f) => f.offsetWidth);
const facesIn = (row) => [...row.querySelectorAll('[data-key]:not([data-transient])')];

/** Before a render: every face in the showing row, member id -> { el, rect }. */
export function captureFaces(root) {
  const row = visibleRow(root);
  return row ? new Map(facesIn(row).map((el) => [el.dataset.key, { el, rect: el.getBoundingClientRect() }])) : null;
}

/** After a render: animate what changed since `before` (from captureFaces). */
export function animateFaces(root, before) {
  const row = visibleRow(root);
  if (!before || !row || reducedMotion()) return;
  const after = new Map(facesIn(row).map((el) => [el.dataset.key, el]));
  // The face that sat to the right of `id` before this render and is still in the row.
  const oldOrder = [...before.keys()];
  const rightOf = (id) => oldOrder.slice(oldOrder.indexOf(id) + 1).map((k) => after.get(k)).find(Boolean) ?? null;
  // On your own pick, the row waits for the sticker's slap, then everything moves at once.
  const arrival = state.arrival;
  const delay = arrival ? SLAP_MS : 0;

  for (const [id, el] of after) {
    if (id === arrival?.id) {
      if (before.has(id)) dropFace(row, before.get(id), rightOf(id), delay);
      peelOff(root, el, arrival.key, delay);
      continue;
    }
    const old = before.get(id);
    if (!old) {
      el.animate([{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
      continue;
    }
    const dx = old.rect.left - el.getBoundingClientRect().left;
    if (Math.abs(dx) > 0.5) {
      el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { ...SLIDE, delay: delay && delay + 80, fill: 'backwards' });
    }
  }
  for (const [id, old] of before) if (!after.has(id)) dropFace(row, old, rightOf(id), 0);
}

// A copy of your sticker lifts off the cell and glides into your face's spot: it
// untilts, swaps the sticker's white border for the row's ring, grows a little as it
// lifts, and settles to size. Across and down follow different curves, so the path
// bends instead of cutting straight. Until the slap is done, the face stays hidden.
function peelOff(root, el, key, delay) {
  const to = el.getBoundingClientRect();
  const cell = root.querySelector(`.cell[data-key="${CSS.escape(key)}"]`);
  const sticker = cell?.querySelector('.sticker');
  const box = cell?.getBoundingClientRect();
  // Where the sticker sits once stuck (offsets ignore its slap transform).
  const from = sticker
    ? { x: box.left + sticker.offsetLeft + sticker.offsetWidth / 2, y: box.top + sticker.offsetTop + sticker.offsetHeight / 2, size: sticker.offsetWidth, tilt: parseFloat(getComputedStyle(sticker).getPropertyValue('--rot')) || 0 }
    : box ? { x: box.left + box.width / 2, y: box.top + box.height / 2, size: to.width, tilt: 0 } : null;
  if (!from) return;
  const dx = from.x - (to.left + to.width / 2);
  const dy = from.y - (to.top + to.height / 2);
  const across = cubicBezier(0.3, 0, 0.15, 1);
  const down = cubicBezier(0.55, 0, 0.2, 1);
  const settle = cubicBezier(0.25, 1, 0.5, 1);
  const startScale = from.size / to.width;
  const frames = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const lift = t < 0.3 ? startScale + (1.3 - startScale) * settle(t / 0.3) : 1.3 - 0.3 * settle((t - 0.3) / 0.7);
    frames.push({
      transform: `translate(${dx * (1 - across(t))}px, ${dy * (1 - down(t))}px) rotate(${from.tilt * (1 - settle(Math.min(1, t * 2)))}deg) scale(${lift})`,
    });
  }
  el.animate(frames, { duration: GLIDE_MS, delay, fill: 'backwards', easing: 'linear' });
  el.animate(
    [
      { boxShadow: '0 0 0 2px #fbfaf6, 0 3px 8px rgba(0, 0, 0, 0.45)' },
      { boxShadow: '0 0 0 2px #00d6a8, 0 12px 24px rgba(0, 0, 0, 0.5)', offset: 0.35 },
      { boxShadow: '0 0 0 2px #161c30, 0 0 0 rgba(0, 0, 0, 0)' },
    ],
    { duration: GLIDE_MS, delay, fill: 'backwards' },
  );
  // Hidden while the sticker slaps on; the copy appears as the slap lands.
  if (delay) el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: delay });
}

// A face that leaves the row hops up, then falls under gravity, tumbling, off the
// bottom of the screen. Rise and fall times come from the same gravity, so a short
// drop (the phone slip at the bottom) is quick and a long one (the desktop sidebar)
// takes longer, the way a real fall would. The falling copy sits in the row at its
// old place, before `rightNeighbor`, so it keeps that place in the stack. It's marked
// transient so a render mid-fall leaves it alone (dom.js).
function dropFace(row, { el, rect }, rightNeighbor, delay) {
  const face = el.cloneNode(true);
  face.classList.add('face-drop');
  face.setAttribute('data-transient', '');
  const box = row.getBoundingClientRect();
  Object.assign(face.style, { left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px` });
  row.insertBefore(face, rightNeighbor);
  const hop = 34;
  const fall = innerHeight - rect.top + rect.height + 20; // below the hop's start point
  const rise = Math.sqrt((2 * hop) / GRAVITY);
  const drop = Math.sqrt((2 * (hop + fall)) / GRAVITY);
  const total = (rise + drop) * 1000;
  const side = Math.random() < 0.5 ? -1 : 1;
  // Sideways drift runs at a steady rate; height follows gravity.
  face.animate({ translate: ['0 0', `${side * (24 + Math.random() * 24)}px 0`] }, { duration: total, delay, easing: 'linear' });
  face.animate(
    [
      { transform: 'translateY(0) rotate(0deg) scale(1)', easing: 'cubic-bezier(0.5, 1, 0.89, 1)' }, // rising, slowing (quadratic)
      { transform: `translateY(-${hop}px) rotate(${side * 25}deg) scale(1.1)`, offset: rise / (rise + drop), easing: 'cubic-bezier(0.11, 0, 0.5, 0)' }, // falling, speeding up
      { transform: `translateY(${fall}px) rotate(${side * (90 + 200 * drop)}deg) scale(1.1)` },
    ],
    { duration: total, delay },
  ).finished.then(() => face.remove());
}

// CSS cubic-bezier(x1, y1, x2, y2) as a function of time 0..1, for paths built frame
// by frame.
function cubicBezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
