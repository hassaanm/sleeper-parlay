// The slip's faces row (everyone with a leg) animates its changes after each render,
// the same way for your picks and for friends' picks arriving live:
//
//   new pick            rolls in from behind the slip's left edge to its spot
//   changed, same spot  jiggles in place as its sticker lands
//   changed, new spot   jumps to its new spot on a real arc, higher for longer jumps
//   removed             rolls off to the right and falls off the screen
//
// The other faces shuffle to their new spots alongside. New picks and changes start
// as the pick's sticker hits its cell on the board (board.js), so the two feel connected.
//
// Each face sits over the face to its left and under the face to its right. A jumping
// face changes that place in the stack once, at the top of its jump, where it's clear
// of the row and nothing overlaps it, so the change never shows.
//
// Old positions are kept relative to the row: removing your leg shrinks the open slip
// and moves the row, and the animations start from where the row is now.
import { STICKER_SLAP_MS } from './ui.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const IMPACT_MS = Math.round(STICKER_SLAP_MS * 0.58); // when a slapped sticker hits its cell
const GRAVITY = 2600; // px/s², for falls
const JUMP_GRAVITY = 1900; // px/s², a touch floatier, so jumps read clearly
const ROLL_OFF_PX = 10; // rolled before tipping off the edge
const ROLL_OFF_S = 0.2;
const ROLL_OFF_DELAY_MS = 190; // a beat in place first, so the roll-off reads
const SHUFFLE = { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
const JUMP_ORIGIN = '50% 100%'; // squash and stretch from the bottom edge, into the ground

// The faces row of whichever slip is showing: the phone slip and the desktop ticket
// are both in the page, and the hidden one measures as 0x0 at the top left.
const visibleRow = (root) => [...root.querySelectorAll('.slip-peek .faces')].find((f) => f.offsetWidth);
const facesIn = (row) => [...row.querySelectorAll('[data-key]:not([data-transient])')];

/**
 * Before a render: every face in the showing row, member id -> { el, at, pick }, where
 * `at` is its position relative to the row.
 */
export function captureFaces(root) {
  const row = visibleRow(root);
  if (!row) return null;
  const box = row.getBoundingClientRect();
  return new Map(facesIn(row).map((el) => {
    const r = el.getBoundingClientRect();
    return [el.dataset.key, { el, at: { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height }, pick: el.dataset.pick }];
  }));
}

/** After a render: animate what changed since `before` (from captureFaces). */
export function animateFaces(root, before) {
  const row = visibleRow(root);
  if (!before || !row || reducedMotion()) return;
  const box = row.getBoundingClientRect();
  const after = new Map(facesIn(row).map((el) => [el.dataset.key, el]));
  const spot = (el) => el.getBoundingClientRect().left - box.left; // where it sits now, in the row
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
  const jumpers = changed.filter((id) => rank(oldOrder, id) !== rank(newOrder, id));
  const stayers = changed.filter((id) => !jumpers.includes(id));

  // How the others shuffle: during the jump's flight; or parting just ahead of a face
  // rolling in; or, for a removal alone, once the leaving face is off the edge.
  const jumps = new Map(jumpers.map((id) => [id, jumpFor(Math.abs(spot(after.get(id)) - before.get(id).at.left))]));
  const rolls = new Map(added.map((id) => [id, rollFor(after.get(id))]));
  let shuffle = { ...SHUFFLE, delay: removed.length ? ROLL_OFF_DELAY_MS + ROLL_OFF_S * 1000 : 0 };
  for (const jump of jumps.values()) shuffle = { duration: jump.airMs, easing: 'cubic-bezier(0.45, 0, 0.35, 1)', delay: IMPACT_MS + jump.crouchMs };
  for (const roll of rolls.values()) {
    const duration = Math.min(520, Math.max(320, roll.openAtMs));
    shuffle = { duration, easing: 'cubic-bezier(0.45, 0, 0.35, 1)', delay: IMPACT_MS + Math.max(0, roll.openAtMs - duration) };
  }

  for (const id of removed) rollOff(row, box, before.get(id), oldRightOf(id));
  for (const [id, roll] of rolls) rollIn(after.get(id), roll, IMPACT_MS);
  for (const [id, jump] of jumps) jumpTo(row, box, after.get(id), before.get(id), oldRightOf(id), jump, IMPACT_MS);
  for (const id of newOrder) {
    if (rolls.has(id) || jumps.has(id)) continue;
    const el = after.get(id);
    const dx = before.get(id).at.left - spot(el);
    if (Math.abs(dx) > 0.5) el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { ...shuffle, fill: 'backwards' });
    if (stayers.includes(id)) jiggle(el, IMPACT_MS);
  }
}

// Builds keyframes by sampling `at(t)` for t from `from` to `to`:
// { x, y, turn, opacity, scaleX, scaleY }.
function frames(at, from = 0, to = 1, steps = 48, origin) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const { x = 0, y = 0, turn = 0, opacity, scaleX = 1, scaleY = 1 } = at(from + ((to - from) * i) / steps);
    return {
      transform: `translate(${x}px, ${y}px) rotate(${turn}deg) scale(${scaleX}, ${scaleY})`,
      ...(opacity === undefined ? {} : { opacity }),
      ...(origin ? { transformOrigin: origin } : {}),
    };
  });
}

const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 2;
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const degreesRolled = (distance, radius) => (distance / radius) * (180 / Math.PI);
// Width moves opposite to height, so a squashed or stretched face keeps its volume.
const squash = (tall) => ({ scaleX: 1 - 0.8 * (tall - 1), scaleY: tall });

// A jump across `distance` px, as a projectile. Jumping farther means pushing off
// harder, and at a similar launch angle the apex rises in step with the distance, so
// the apex is a base that clears the row plus half the distance. Air time follows
// from gravity, and the crouch, stretch, and landing grow with the jump.
function jumpFor(distance) {
  const height = 32 + distance * 0.5;
  const airMs = 2 * Math.sqrt((2 * height) / JUMP_GRAVITY) * 1000;
  const size = Math.min(1, (height - 32) / 70); // 0 for a short hop, 1 for a long leap
  return {
    height,
    airMs,
    crouchMs: 130 + 70 * size,
    landMs: 170 + 90 * size,
    crouch: 0.18 + 0.1 * size,
    stretch: 0.12 + 0.1 * size,
    thud: 0.18 + 0.1 * size,
  };
}

// A face jumping to a new spot: it crouches, launches, flies a real arc, and lands
// with a thud. The real face takes off from its old place in the stack; at the top of
// the arc, a copy waiting hidden in the new spot (so in its new place in the stack)
// takes over and comes down. The copy has its image decoded by then, so the handover
// can't blink; the two overlap for a frame.
function jumpTo(row, box, el, old, oldRight, jump, delay) {
  const to = el.getBoundingClientRect().left - box.left;
  const dx = to - old.at.left;
  const total = jump.crouchMs + jump.airMs + jump.landMs;
  const crouchEnd = jump.crouchMs / total;
  const airEnd = (jump.crouchMs + jump.airMs) / total;
  const pose = (t) => {
    if (t < crouchEnd) return squash(1 - jump.crouch * easeOut(t / crouchEnd));
    if (t < airEnd) {
      const v = (t - crouchEnd) / (airEnd - crouchEnd);
      // Fastest, so most stretched, at takeoff and touchdown; round at the top.
      const airStretch = v < 0.5 ? jump.stretch * (1 - v * 2) : jump.stretch * 0.6 * (v * 2 - 1);
      const tall = v < 0.12 ? lerp(1 - jump.crouch, 1 + airStretch, easeOut(v / 0.12)) : 1 + airStretch;
      return {
        // Nearly steady sideways speed (a real arc), easing a little at both ends so
        // it lifts clear of its neighbors before crossing them.
        x: dx * (0.6 * v + 0.4 * easeInOut(v)),
        y: -jump.height * 4 * v * (1 - v),
        turn: Math.sign(dx) * 12 * Math.sin(Math.PI * v),
        ...squash(tall),
      };
    }
    const w = (t - airEnd) / (1 - airEnd);
    const tall = w < 0.35 ? lerp(1 + jump.stretch * 0.6, 1 - jump.thud, easeOut(w / 0.35))
      : w < 0.7 ? lerp(1 - jump.thud, 1 + jump.thud * 0.3, easeInOut((w - 0.35) / 0.35))
        : lerp(1 + jump.thud * 0.3, 1, easeInOut((w - 0.7) / 0.3));
    return { x: dx, ...squash(tall) };
  };
  const apex = (crouchEnd + airEnd) / 2;

  const copy = el.cloneNode(true);
  el.replaceWith(copy);
  // The real face, back in its old place in the stack, takes off.
  for (const animation of el.getAnimations()) animation.cancel();
  el.classList.add('face-drop');
  el.setAttribute('data-transient', '');
  Object.assign(el.style, { left: `${old.at.left}px`, top: `${old.at.top}px` });
  row.insertBefore(el, oldRight);
  const handover = apex + 1 / 60;
  el.animate(frames(pose, 0, handover, 30, JUMP_ORIGIN), { duration: total * handover, delay, fill: 'backwards', easing: 'linear' })
    .finished.then(() => el.remove());

  // The copy, in its new spot: hidden until the apex, then down into its place.
  copy.animate(
    frames((t) => ({ ...pose(t), x: pose(t).x - dx, opacity: t >= apex ? 1 : 0 }), 0, 1, 60, JUMP_ORIGIN),
    { duration: total, delay, fill: 'backwards', easing: 'linear' },
  );
}

// A face whose pick changed but kept its spot jiggles in place as its sticker lands,
// like a rubber band: the whole face squeezes wide, springs tall, wide, tall, dying
// out, with its base kept on the ground.
const JIGGLE = [[0, 1], [0.3, 1.22], [0.42, 0.8], [0.54, 1.12], [0.68, 0.94], [0.8, 1.04], [1, 1]]; // [time, width]
function jiggle(el, delay) {
  el.animate(
    JIGGLE.map(([offset, wide]) => ({ offset, transform: `scale(${wide}, ${2 - wide})`, transformOrigin: JUMP_ORIGIN, easing: 'ease-in-out' })),
    { duration: 720, delay },
  );
}

// A new face rolls in from behind the slip's left edge (the row is clipped there) at
// one steady speed, wherever its spot is, slowing only over its last few pixels to a
// stop. Its turn is worked back from the spot, so it arrives exactly upright.
// `openAtMs` is when it's one face from its spot: the others have made room by then.
const ROLL_SPEED = 300; // px/s
const ROLL_BRAKE_PX = 28; // slowing to a stop over the last stretch
function rollFor(el) {
  const rect = el.getBoundingClientRect();
  const curtain = el.closest('.slip-peek')?.getBoundingClientRect().left ?? 0;
  const distance = rect.right - curtain + 2; // from just behind the slip's left edge
  const brake = Math.min(ROLL_BRAKE_PX, distance);
  const cruiseMs = ((distance - brake) / ROLL_SPEED) * 1000;
  const brakeMs = ((2 * brake) / ROLL_SPEED) * 1000; // steady slowdown from speed to 0
  const duration = cruiseMs + brakeMs;
  // Distance still to go at time t (ms).
  const left = (t) => (t < cruiseMs ? distance - (ROLL_SPEED * t) / 1000 : brake * (1 - (t - cruiseMs) / brakeMs) ** 2);
  let openAtMs = 0;
  while (openAtMs < duration && left(openAtMs) > rect.width) openAtMs += 10;
  return { left, duration, radius: rect.width / 2, openAtMs };
}
function rollIn(el, { left, duration, radius }, delay) {
  el.animate(
    frames((t) => {
      const x = -left(t * duration);
      return { x, turn: degreesRolled(x, radius) };
    }, 0, 1, Math.max(24, Math.round(duration / 16))),
    { duration, delay, fill: 'backwards', easing: 'linear' },
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
function rollOff(row, box, { el, at }, oldRight) {
  for (const animation of el.getAnimations()) animation.cancel();
  el.classList.add('face-drop');
  el.setAttribute('data-transient', '');
  Object.assign(el.style, { left: `${at.left}px`, top: `${at.top}px` });
  row.insertBefore(el, oldRight);

  const radius = at.width / 2;
  const accel = (2 * ROLL_OFF_PX) / ROLL_OFF_S ** 2; // rolling from rest
  const speed = accel * ROLL_OFF_S; // sideways speed at the edge, kept in the air
  const fall = innerHeight - (box.top + at.top) + at.height + 20;
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
    { duration: total * 1000, delay: ROLL_OFF_DELAY_MS, fill: 'backwards', easing: 'linear' },
  ).finished.then(() => el.remove());
}
