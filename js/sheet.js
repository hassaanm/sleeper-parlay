// The phone's pull-up slip: opening and closing it, dragging it by its top edge, and
// the page's scroll lock behind it. Also places the tear line on both slips' paper.
import { state } from './state.js';

let $root = null;
let rerender = () => {};
let drag = null; // the drag in progress: where it started, where it is, how fast

// Phone widths, where the slip is a sheet over the page. At 960px and up it's a
// sidebar ticket instead (styles.css).
const PHONE = matchMedia('(max-width: 959px)');

// The page behind an open slip or a research page doesn't scroll. On desktop the slip
// is a sidebar, so only a research page locks it.
export function syncScrollLock() {
  document.body.classList.toggle('no-scroll', (state.sheetOpen && PHONE.matches) || state.pages.length > 0);
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
// cuts them at --tear from the bottom, so tell it how tall the footer is.
export function syncTearLine() {
  for (const paper of $root.querySelectorAll('.paper[data-paper]')) {
    const foot = paper.parentElement.querySelector(':scope > .parlay-foot');
    if (!foot || !paper.offsetHeight) continue; // hidden at this screen size
    const fromBottom = paper.getBoundingClientRect().bottom - foot.getBoundingClientRect().top;
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
  if (!handle) return;
  const slip = handle.closest('.slip');
  const closedY = slip.offsetHeight - handle.offsetHeight - safeBottom();
  drag = { slip, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, base: state.sheetOpen ? 0 : closedY, closedY, moved: false };
  slip.style.transition = 'none';
  handle.setPointerCapture(e.pointerId);
}

function moveDrag(e) {
  if (!drag) return;
  const d = drag;
  const dy = e.clientY - d.startY;
  if (Math.abs(dy) > 5) d.moved = true;
  if (!d.moved) return;
  d.velocity = (e.clientY - d.lastY) / Math.max(1, e.timeStamp - d.lastT);
  d.lastY = e.clientY;
  d.lastT = e.timeStamp;
  d.y = Math.min(d.closedY, Math.max(0, d.base + dy));
  d.slip.style.transform = `translateY(${d.y}px)`;
  $root.querySelector('.slip-backdrop').style.opacity = String(1 - d.y / d.closedY);
}

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.pendingRender) setTimeout(rerender, 400);
  d.slip.style.transition = '';
  d.slip.style.transform = '';
  $root.querySelector('.slip-backdrop').style.opacity = '';
  if (!d.moved) return setSlipOpen(!state.sheetOpen);
  const flungUp = d.velocity < -0.4;
  const flungDown = d.velocity > 0.4;
  setSlipOpen(flungUp || (!flungDown && d.y < d.closedY / 2));
}

export function initSheet(root, render) {
  $root = root;
  rerender = render;
  root.addEventListener('pointerdown', startDrag);
  root.addEventListener('pointermove', moveDrag);
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.slip-handle')) {
      e.preventDefault();
      setSlipOpen(!state.sheetOpen);
    }
  });
  window.addEventListener('resize', () => requestAnimationFrame(syncTearLine));
  PHONE.addEventListener('change', syncScrollLock);
}
