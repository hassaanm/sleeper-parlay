// The slip as a picture to share. makeSlipPicture draws the whole slip (slip.js
// renderShareCard) into a PNG; the share sheet (slip.js renderShareSheet) then shows it
// with Share, Copy, and Save. It takes a second tap to share because an iPhone only
// opens its share sheet straight from a tap, and drawing the picture takes longer than
// that. On a phone the picture can also be pressed and held, for Copy and Save to Photos.
import { state } from './state.js';
import { renderShareCard } from './views/slip.js';

// Draws HTML into an image. Only loaded when someone shares.
const DRAW = 'https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/+esm';

export async function makeSlipPicture() {
  const { domToBlob } = await import(DRAW);
  // Laid out off screen at a phone's width, so it's the same picture from any screen.
  const holder = document.createElement('div');
  holder.className = 'shot-holder';
  holder.innerHTML = renderShareCard();
  document.body.appendChild(holder);
  try {
    const shot = holder.firstElementChild;
    // The paper's side notches go on the tear line above the totals, as sheet.js
    // syncTearLine does for the slips on screen (the ticket's mask box is 5px short).
    const paper = shot.querySelector('.paper');
    const foot = shot.querySelector('.parlay-foot');
    paper.style.setProperty('--tear', `${Math.round(paper.getBoundingClientRect().bottom - foot.getBoundingClientRect().top - 5)}px`);
    await Promise.all([...shot.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
    // Logos and faces are fetched again, past the browser's cache: the copies it already
    // has came from plain <img> loads, without the CORS header a picture needs.
    const blob = await domToBlob(shot, { scale: 3, type: 'image/png', fetch: { requestInit: { cache: 'reload' } } });
    return new File([blob], `parlay-week-${state.slip.week}.png`, { type: 'image/png' });
  } finally {
    holder.remove();
  }
}

// The open share sheet's picture, as a file and a URL for its <img>.
export function showPicture(file) {
  closePicture();
  state.share = { file, url: URL.createObjectURL(file), copied: false };
}

export function closePicture() {
  if (state.share?.url) URL.revokeObjectURL(state.share.url);
  state.share = null;
}

export const canShareFile = (file) => !!navigator.canShare?.({ files: [file] });
export const canCopyImage = () => !!(window.ClipboardItem && navigator.clipboard?.write);

// Opens the phone's share sheet. Closing it without picking anything isn't an error.
export const sharePicture = (file) => navigator.share({ files: [file] }).catch((e) => {
  if (e.name !== 'AbortError') throw e;
});

export const copyPicture = (file) => navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]);
