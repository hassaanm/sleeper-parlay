// The page shell: which screen shows for the current state (landing, loading, error,
// admin, "Who's picking?", or the board with its slip), plus the toast.
import { basePath, memberById, state } from '../state.js';
import { esc } from '../ui.js';
import { renderActingBar, renderAdmin } from './admin.js';
import { renderGames, renderLockBar, renderSubbar, renderTopbar, renderWhoAreYou } from './board.js';
import { renderPage } from './pages.js';
import { renderParlayCard, renderSlip } from './slip.js';

export const renderApp = () => (state.slipId ? renderSlipPage() : renderLanding()) + renderToast();

function renderToast() {
  if (!state.toast) return '';
  return `<div class="toast toast-${state.toast.tone}" role="status" id="toast-${state.toast.id}">${esc(state.toast.message)}</div>`;
}

function renderLanding() {
  const l = state.landing;
  return `
  <main class="landing">
    <section class="hero">
      <div class="brand-mark">🏈</div>
      <h1>Parlay Pool</h1>
      <p class="lede">Everyone in your Sleeper league adds one leg. One slip, live NFL lines.</p>
    </section>
    <form data-form="league" class="card league-form">
      <label for="league-query" class="field-label">Sleeper league ID</label>
      <div class="search-row">
        <input id="league-query" class="input" placeholder="e.g. 1365380346513723392" value="${esc(l.query)}" autocomplete="off" inputmode="numeric">
        <button class="btn btn-primary">Open</button>
      </div>
      ${l.error ? `<p class="error">${esc(l.error)}</p>` : '<p class="hint">It’s the long number in your league’s Sleeper URL.</p>'}
    </form>
  </main>`;
}

function renderSlipPage() {
  if (state.slip === undefined) return `<main class="center"><div class="spinner"></div></main>`;
  if (state.slip === null) {
    return `<main class="center"><div class="card narrow"><h2>Couldn’t open this league</h2><p class="muted">${esc(state.loadError ?? 'Something went wrong.')}</p><button class="btn btn-primary" data-action="reload-page">Try again</button> <a class="btn" href="${basePath}">Try another league</a></div></main>`;
  }
  if (state.admin.route && !state.acting) return renderTopbar(null) + renderAdmin();
  const me = memberById(state.me);
  if (!me || state.switchingUser) return renderTopbar(null) + renderWhoAreYou(me);

  return `
    ${renderActingBar()}
    <div class="chrome">${renderTopbar(me)}${renderSubbar()}</div>
    <div class="layout">
      <main class="games">${renderLockBar()}${renderGames()}</main>
      <aside class="parlay-side">${renderParlayCard()}</aside>
    </div>
    ${renderSlip()}
    ${state.pages.length ? renderPage() : ''}`;
}
