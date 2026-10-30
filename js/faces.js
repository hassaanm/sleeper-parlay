// The slip's faces row (everyone with a leg) animates its changes after each render:
// faces that moved slide to their new spots, new faces pop in, and faces that left
// fall off the screen. Your own pick is one connected move: your sticker slaps onto the
// cell you tapped (board.js), then a copy peels off it and glides into your spot in
// the row, while your old face falls out and the others slide aside to make room.
//
// Everything moves inside the row, so each face keeps its place in the stack: over the
// face to its left, under the face to its right.
import { state } from './state.js';
import { STICKER_SLAP_MS } from './ui.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// The copy peels off once the sticker has landed and settled, after a short beat.
const PEEL_DELAY = STICKER_SLAP_MS + 150;
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
  // On your own pick, your copy peels off once the sticker sticks. The others close
  // up and open your new spot as soon as your old face rolls off the edge, so the
  // spot is waiting for you; on a first pick there's no old face, and they make room
  // as the copy peels off.
  const arrival = state.arrival;
  const delay = arrival ? PEEL_DELAY : 0;
  const slideDelay = !arrival ? 0 : before.has(arrival.id) ? ROLL_S * 1000 : PEEL_DELAY + 80;

  for (const [id, el] of after) {
    if (id === arrival?.id) {
      let face = el;
      if (before.has(id)) {
        // Your old face falls right away, as itself (already drawn); a copy takes the new
        // spot, hidden until it peels in. A fresh image would blink while it decodes.
        face = el.cloneNode(true);
        el.replaceWith(face);
        dropFace(row, { el, rect: before.get(id).rect }, rightOf(id));
      }
      peelOff(root, face, arrival.key, delay);
      continue;
    }
    const old = before.get(id);
    if (!old) {
      el.animate([{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
      continue;
    }
    const dx = old.rect.left - el.getBoundingClientRect().left;
    if (Math.abs(dx) > 0.5) {
      el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { ...SLIDE, delay: slideDelay, fill: 'backwards' });
    }
  }
  for (const [id, old] of before) if (!after.has(id)) dropFace(row, old, rightOf(id));
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
  // Hidden while the sticker slaps on; the copy appears as it starts to peel off.
  if (delay) el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: delay });
}

// A face that leaves the row rolls off its left edge like a ball off a cliff: it starts
// rolling from rest and speeds up over a few pixels, then leaves the edge and falls.
// In the air it keeps the small sideways speed it rolled off with while gravity pulls
// it straight down, faster and faster, so the path curves into a near-vertical drop;
// it keeps spinning at the rate it was rolling. Positions come from the physics frame
// by frame. The face (the real element, never a fresh copy, so it can't blink) sits in
// the row at its old place, before `rightNeighbor`, so it keeps that place in the
// stack. It's marked transient so a render mid-fall leaves it alone (dom.js).
const ROLL_PX = 10; // rolled before leaving the edge
const ROLL_S = 0.2;
function dropFace(row, { el, rect }, rightNeighbor) {
  for (const animation of el.getAnimations()) animation.cancel();
  el.classList.add('face-drop');
  el.setAttribute('data-transient', '');
  const box = row.getBoundingClientRect();
  Object.assign(el.style, { left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px` });
  row.insertBefore(el, rightNeighbor);

  const radius = rect.width / 2;
  const accel = (2 * ROLL_PX) / ROLL_S ** 2; // rolling from rest
  const speed = accel * ROLL_S; // sideways speed at the edge, kept in the air
  const fall = innerHeight - rect.top + rect.height + 20;
  const airtime = Math.sqrt((2 * fall) / GRAVITY);
  const total = ROLL_S + airtime;
  const frames = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * total;
    const rolling = t < ROLL_S;
    const air = t - ROLL_S;
    const x = rolling ? 0.5 * accel * t ** 2 : ROLL_PX + speed * air;
    const y = rolling ? 0 : 0.5 * GRAVITY * air ** 2;
    // Rolling without slipping turns it by distance / radius; in the air it keeps
    // spinning at the rate it left the edge.
    const turn = (x / radius) * (180 / Math.PI);
    frames.push({ transform: `translate(${-x}px, ${y}px) rotate(${-turn}deg)` });
  }
  el.animate(frames, { duration: total * 1000, easing: 'linear' }).finished.then(() => el.remove());
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
