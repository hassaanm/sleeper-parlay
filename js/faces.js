// The slip's faces row (everyone with a leg) animates its changes after each render,
// the same way for your picks and for friends' picks arriving live:
//
//   new pick            rolls in from the left edge of the screen to its spot
//   changed, same spot  a tiny hop in place
//   changed, new spot   a big hop: up clear of the row, over, and down into its spot
//   removed             rolls off to the right and falls off the screen
//
// The other faces shuffle to their new spots alongside. New picks and hops start as
// the pick's sticker hits its cell on the board (board.js), so the two feel connected.
//
// Each face sits over the face to its left and under the face to its right. A hopping
// face changes that place in the stack once, at the top of its hop, where it's clear
// of the row and nothing overlaps it, so the change never shows.
import { STICKER_SLAP_MS } from './ui.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const IMPACT_MS = Math.round(STICKER_SLAP_MS * 0.58); // when a slapped sticker hits its cell
const GRAVITY = 2600; // px/s²
const ROLL_OFF_PX = 10; // rolled before tipping off the edge
const ROLL_OFF_S = 0.2;
const HOP_MS = 720;
const HOP_HEIGHT = 46;
const TINY_HOP_MS = 300;
const SHUFFLE = { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };

// The faces row of whichever slip is showing: the phone slip and the desktop ticket
// are both in the page, and the hidden one measures as 0x0 at the top left.
const visibleRow = (root) => [...root.querySelectorAll('.slip-peek .faces')].find((f) => f.offsetWidth);
const facesIn = (row) => [...row.querySelectorAll('[data-key]:not([data-transient])')];

/** Before a render: every face in the showing row, member id -> { el, rect, pick }. */
export function captureFaces(root) {
  const row = visibleRow(root);
  return row ? new Map(facesIn(row).map((el) => [el.dataset.key, { el, rect: el.getBoundingClientRect(), pick: el.dataset.pick }])) : null;
}

/** After a render: animate what changed since `before` (from captureFaces). */
export function animateFaces(root, before) {
  const row = visibleRow(root);
  if (!before || !row || reducedMotion()) return;
  const after = new Map(facesIn(row).map((el) => [el.dataset.key, el]));
  const oldOrder = [...before.keys()];
  const newOrder = [...after.keys()];
  // The face that sat to the right of `id` before this render and is still in the row.
  const oldRightOf = (id) => oldOrder.slice(oldOrder.indexOf(id) + 1).map((k) => after.get(k)).find(Boolean) ?? null;
  // Where a face ranks among the faces in both renders, to tell a real move from a
  // shift caused by someone else coming or going.
  const kept = new Set(oldOrder.filter((id) => after.has(id)));
  const rank = (order, id) => order.filter((k) => kept.has(k)).indexOf(id);

  const added = newOrder.filter((id) => !before.has(id));
  const removed = oldOrder.filter((id) => !after.has(id));
  const changed = [...kept].filter((id) => before.get(id).pick !== after.get(id).dataset.pick);
  const hops = changed.filter((id) => rank(oldOrder, id) !== rank(newOrder, id));
  const tinyHops = changed.filter((id) => !hops.includes(id));

  // The others shuffle while an arriving face rolls in or a hopping face is in the
  // air; for a removal alone, once the leaving face is off the edge.
  const shuffleDelay = added.length || hops.length ? IMPACT_MS + (hops.length ? HOP_MS * 0.15 : 0) : removed.length ? ROLL_OFF_S * 1000 : 0;

  for (const id of removed) rollOff(row, before.get(id), oldRightOf(id));
  for (const id of added) rollIn(after.get(id), IMPACT_MS);
  for (const id of hops) hop(row, after.get(id), before.get(id), oldRightOf(id), IMPACT_MS);
  for (const id of newOrder) {
    if (added.includes(id) || hops.includes(id)) continue;
    const el = after.get(id);
    const dx = before.get(id).rect.left - el.getBoundingClientRect().left;
    if (tinyHops.includes(id)) tinyHop(el, dx, IMPACT_MS);
    else if (Math.abs(dx) > 0.5) el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { ...SHUFFLE, delay: shuffleDelay, fill: 'backwards' });
  }
}

// Builds keyframes by sampling `at(t)` for t from `from` to `to`:
// { x, y, turn, opacity, scaleX, scaleY }.
function frames(at, from = 0, to = 1, steps = 48) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const { x = 0, y = 0, turn = 0, opacity, scaleX = 1, scaleY = 1 } = at(from + ((to - from) * i) / steps);
    return {
      transform: `translate(${x}px, ${y}px) rotate(${turn}deg) scale(${scaleX}, ${scaleY})`,
      ...(opacity === undefined ? {} : { opacity }),
    };
  });
}

const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const degreesRolled = (distance, radius) => (distance / radius) * (180 / Math.PI);

// A new face rolls in from just off the left edge of the screen and coasts to a stop
// in its spot, turning as it rolls. It passes over the faces to its left, which sit
// under it anyway.
function rollIn(el, delay) {
  const rect = el.getBoundingClientRect();
  const start = -(rect.right + 12); // just past the left edge
  const duration = Math.min(1000, Math.max(520, 250 + Math.abs(start) * 0.9));
  const radius = rect.width / 2;
  el.animate(
    frames((t) => {
      const x = start * (1 - t) ** 2; // slowing to a stop
      return { x, turn: degreesRolled(x, radius) };
    }),
    { duration, delay, fill: 'backwards', easing: 'linear' },
  );
}

// A face whose pick changed but kept its spot hops in place (sliding over too, if
// someone else's change shifted the row).
function tinyHop(el, dx, delay) {
  el.animate(
    frames((t) => ({ x: dx * (1 - easeInOut(t)), y: -9 * 4 * t * (1 - t) })),
    { duration: TINY_HOP_MS, delay, fill: 'backwards', easing: 'linear' },
  );
}

// A face whose pick moved it hops from its old spot to its new one. The real face
// takes off from its old place in the stack; at the top of the hop, a copy waiting
// hidden in the new spot (so in its new place in the stack) takes over and comes down.
// The copy has its image decoded by then, so the handover can't blink; the two
// overlap for a frame.
function hop(row, el, old, oldRight, delay) {
  const to = el.getBoundingClientRect();
  const dx = to.left - old.rect.left;
  // Up and down on a parabola; across mostly while high, so it leaves and lands nearly
  // straight up and down. A little tilt toward where it's going.
  const path = (t) => ({
    x: dx * easeInOut(t),
    y: -HOP_HEIGHT * 4 * t * (1 - t),
    turn: Math.sign(dx) * 14 * Math.sin(Math.PI * t),
  });
  const copy = el.cloneNode(true);
  el.replaceWith(copy);
  // The real face, back in its old place in the stack, takes off.
  for (const animation of el.getAnimations()) animation.cancel();
  el.classList.add('face-drop');
  el.setAttribute('data-transient', '');
  const box = row.getBoundingClientRect();
  Object.assign(el.style, { left: `${old.rect.left - box.left}px`, top: `${old.rect.top - box.top}px` });
  row.insertBefore(el, oldRight);
  const apex = 0.5;
  const handover = apex + 1 / 48;
  el.animate(frames(path, 0, handover, 12), { duration: HOP_MS * handover, delay, fill: 'backwards', easing: 'linear' })
    .finished.then(() => el.remove());

  // The copy, in its new spot: hidden until the apex, then down into its place with a
  // small squash on touchdown.
  copy.animate(
    frames((t) => {
      const p = path(t);
      const landing = t > 0.9 ? Math.sin(((t - 0.9) / 0.1) * Math.PI) : 0;
      return {
        ...p,
        x: p.x - dx,
        opacity: t >= apex ? 1 : 0,
        scaleX: 1 + 0.08 * landing,
        scaleY: 1 - 0.1 * landing,
      };
    }),
    { duration: HOP_MS, delay, fill: 'backwards', easing: 'linear' },
  );
}

// A removed face rolls off to the right like a ball off a cliff: it starts rolling
// from rest and speeds up over a few pixels, then leaves the edge and falls. In the
// air it keeps the small sideways speed it rolled off with while gravity pulls it
// straight down, faster and faster, so the path curves into a near-vertical drop; it
// keeps spinning at the rate it was rolling. The face (the real element, never a fresh
// copy, so it can't blink) sits in the row at its old place, before `oldRight`, so it
// keeps that place in the stack. It's marked transient so a render mid-fall leaves it
// alone (dom.js).
function rollOff(row, { el, rect }, oldRight) {
  for (const animation of el.getAnimations()) animation.cancel();
  el.classList.add('face-drop');
  el.setAttribute('data-transient', '');
  const box = row.getBoundingClientRect();
  Object.assign(el.style, { left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px` });
  row.insertBefore(el, oldRight);

  const radius = rect.width / 2;
  const accel = (2 * ROLL_OFF_PX) / ROLL_OFF_S ** 2; // rolling from rest
  const speed = accel * ROLL_OFF_S; // sideways speed at the edge, kept in the air
  const fall = innerHeight - rect.top + rect.height + 20;
  const airtime = Math.sqrt((2 * fall) / GRAVITY);
  const total = ROLL_OFF_S + airtime;
  el.animate(
    frames((u) => {
      const t = u * total;
      const rolling = t < ROLL_OFF_S;
      const air = t - ROLL_OFF_S;
      const x = rolling ? 0.5 * accel * t ** 2 : ROLL_OFF_PX + speed * air;
      return { x, y: rolling ? 0 : 0.5 * GRAVITY * air ** 2, turn: degreesRolled(x, radius) };
    }),
    { duration: total * 1000, easing: 'linear' },
  ).finished.then(() => el.remove());
}
