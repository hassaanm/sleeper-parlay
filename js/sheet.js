// The phone's pull-up slip: opening and closing it, dragging it by its top edge, and
// the page's scroll lock behind it. Also places the tear line on both slips' paper.
import { state } from './state.js';

let $root = null;
let rerender = () => {};
let drag = null; // the drag in progress: where it started, where it is, how fast

// Phone widths, where the slip is a sheet over the page. At 960px and up it's a
// sidebar ticket instead (styles.css).
const PHONE = matchMedia('not all and (min-width: 960px)');

// The page behind an open slip or a research page doesn't scroll. On desktop the slip
// is a sidebar, and screens without the slip (like "Who's picking?") don't have one, so
// only a research page locks those.
export function syncScrollLock() {
  const slipOver = state.sheetOpen && PHONE.matches && !!$root?.querySelector('.slip-wrap');
  document.body.classList.toggle('no-scroll', slipOver || state.pages.length > 0);
}

// Open/close without a full re-render, so the slide animates from where it is.
export function setSlipOpen(open) {
  state.sheetOpen = open;
  state.slipNudge = false;
  const wrap = $root.querySelector('.slip-wrap');
  wrap?.classList.toggle('open', open);
  wrap?.querySelector('.slip-handle')?.setAttribute('aria-expanded', String(open));
  syncScrollLock();
  if (!open) wrap?.querySelector('.sheet-body')?.scrollTo(0, 0);
}

// A render mid-drag would replace the slip under the finger. While a drag is on, this
// returns true and the render runs once the slip is let go.
export function holdRender() {
  if (!drag) return false;
  drag.pendingRender = true;
  return true;
}

// Puts the paper's side notches exactly on the tear line above the totals: the mask
// cuts them at --tear from the bottom, so tell it how far up the totals start. On the
// phone the totals scroll with the legs, so this runs on every scroll too, and the legs
// box gets its own notches there (--notch-y, from its top).
export function syncTearLine() {
  for (const paper of $root.querySelectorAll('.paper[data-paper]')) {
    const foot = paper.parentElement.querySelector('.parlay-foot');
    if (!foot || !paper.offsetHeight) continue; // hidden at this screen size
    const footTop = foot.getBoundingClientRect().top;
    const body = foot.closest('.sheet-body');
    if (body) body.style.setProperty('--notch-y', `${Math.round(footTop - body.getBoundingClientRect().top)}px`);
    const fromBottom = paper.getBoundingClientRect().bottom - footTop;
    // Desktop's body mask box is inset 5px from the bottom.
    const tear = Math.round(fromBottom - (paper.dataset.paper === 'ticket' ? 5 : 0));
    // Kept in state so the next render writes the same value instead of clearing it.
    if (state.tear[paper.dataset.paper] === tear) continue;
    state.tear[paper.dataset.paper] = tear;
    paper.style.setProperty('--tear', `${tear}px`);
  }
}

let safeArea = null;
function safeBottom() {
  if (safeArea === null) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom);visibility:hidden';
    document.body.appendChild(probe);
    safeArea = probe.offsetHeight;
    probe.remove();
  }
  return safeArea;
}

// Drag the slip by its top edge; it follows the finger, then snaps open or closed
// based on where it's let go and how fast it was moving. A tap toggles it.
function startDrag(e) {
  const handle = e.target.closest('.slip-handle');
  // A button in the top row (Share) is its own tap, not a drag.
  if (e.target.closest('.slip-handle button')) return;
  // One finger (or the main mouse button) at a time.
  if (!handle || drag || !e.isPrimary || e.button !== 0) return;
  beginDrag(handle.closest('.slip'), e.pointerId, e.clientY, e.timeStamp, !state.sheetOpen);
  handle.setPointerCapture(e.pointerId);
}

function beginDrag(slip, id, y, t, closed) {
  const closedY = slip.offsetHeight - slip.querySelector('.slip-handle').offsetHeight - safeBottom();
  drag = { id, slip, startY: y, lastY: y, lastT: t, velocity: 0, base: closed ? closedY : 0, closedY, moved: false };
  slip.style.transition = 'none';
}

function follow(d, y, t) {
  d.velocity = (y - d.lastY) / Math.max(1, t - d.lastT);
  d.lastY = y;
  d.lastT = t;
  d.y = Math.min(d.closedY, Math.max(0, d.base + y - d.startY));
  d.slip.style.transform = `translateY(${d.y}px)`;
  $root.querySelector('.slip-backdrop').style.opacity = String(1 - d.y / d.closedY);
}

// Lets go of the slip, which then slides to where it's headed (or stays put for a tap).
function release(d) {
  drag = null;
  if (d.pendingRender) setTimeout(rerender, 400);
  d.slip.style.transition = '';
  d.slip.style.transform = '';
  $root.querySelector('.slip-backdrop').style.opacity = '';
}

function moveDrag(e) {
  if (drag?.id !== e.pointerId) return;
  const d = drag;
  if (Math.abs(e.clientY - d.startY) > 5) d.moved = true;
  if (d.moved) follow(d, e.clientY, e.timeStamp);
}

function endDrag(e) {
  if (drag?.id !== e.pointerId) return;
  const d = drag;
  release(d);
  // A tap toggles; a cancelled touch (the browser took it, like a long-press menu) doesn't.
  if (!d.moved) return e.type === 'pointerup' && setSlipOpen(!state.sheetOpen);
  settle(d);
}

const settle = (d) => {
  const flungUp = d.velocity < -0.4;
  const flungDown = d.velocity > 0.4;
  setSlipOpen(flungUp || (!flungDown && d.y < d.closedY / 2));
};

// The open slip's legs and totals: pulling down while they're scrolled to the top drags
// the whole slip down instead, to close it, the same as dragging its top row. Touch
// events, since only they can stop the list's own scroll-and-bounce mid-gesture.
let pull = null; // the touch in the list: where it started
function listTouchStart(e) {
  const body = e.target.closest('.slip .sheet-body');
  pull = body && state.sheetOpen && !drag && e.touches.length === 1 ? { body, y: e.touches[0].clientY } : null;
}

function listTouchMove(e) {
  if (!pull) return;
  const y = e.touches[0].clientY;
  if (!drag) {
    // Only a pull down from the very top, and only while the browser still lets us take
    // the gesture (not once its own scroll is underway).
    if (y <= pull.y || pull.body.scrollTop > 0 || !e.cancelable) return;
    beginDrag(pull.body.closest('.slip'), 'list', y, e.timeStamp, false);
    drag.moved = true;
  }
  if (drag.id !== 'list') return;
  e.preventDefault();
  follow(drag, y, e.timeStamp);
}

// The touch listeners sit on the slip itself, not the whole app, so a blocking touchmove
// listener never slows the page's own scrolling. Called after each render; binds a new
// slip element once.
const bound = new WeakSet();
export function bindSlipPull() {
  const slip = $root.querySelector('.slip');
  if (!slip || bound.has(slip)) return;
  bound.add(slip);
  slip.addEventListener('touchstart', listTouchStart, { passive: true });
  slip.addEventListener('touchmove', listTouchMove, { passive: false });
  slip.addEventListener('touchend', listTouchEnd);
  slip.addEventListener('touchcancel', listTouchEnd);
}

function listTouchEnd() {
  pull = null;
  if (drag?.id !== 'list') return;
  const d = drag;
  release(d);
  settle(d);
}

export function initSheet(root, render) {
  $root = root;
  rerender = render;
  root.addEventListener('pointerdown', startDrag);
  root.addEventListener('pointermove', moveDrag);
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  // The totals scroll with the legs on the phone; their tear-line notches follow.
  let tearFrame = 0;
  root.addEventListener('scroll', (e) => {
    if (tearFrame || !e.target.closest?.('.slip .sheet-body')) return;
    tearFrame = requestAnimationFrame(() => { tearFrame = 0; syncTearLine(); });
  }, true);
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.slip-handle') && !e.target.closest('button')) {
      e.preventDefault();
      setSlipOpen(!state.sheetOpen);
    }
  });
  window.addEventListener('resize', () => {
    safeArea = null; // the safe area changes when the phone rotates
    requestAnimationFrame(syncTearLine);
  });
  PHONE.addEventListener('change', syncScrollLock);
}
