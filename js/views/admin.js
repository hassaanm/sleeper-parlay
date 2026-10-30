// The admin page and the bar shown while the admin picks for someone else.
import { LOCK_LEAD_MS } from '../rules.js';
import { basePath, isLocked, memberById, picks, state } from '../state.js';
import { avatar, dayTimeFmt, esc, pretty } from '../ui.js';

// "<league URL>?admin": set the pick deadline, lock or unlock picks, and fix anyone's
// pick. The password only keeps casual visitors out.
export function renderAdmin() {
  if (!state.admin.authed) {
    return `
    <main class="who">
      <form data-form="admin-login" class="card admin-login">
        <h1>Admin</h1>
        <input id="admin-password" class="input" type="password" placeholder="Password" autocomplete="current-password">
        ${state.admin.error ? `<p class="error">${esc(state.admin.error)}</p>` : ''}
        <button class="btn btn-primary btn-block">Unlock</button>
      </form>
    </main>`;
  }
  const { cutoff, locked } = state.slip.settings;
  const when = (t) => dayTimeFmt.format(t);
  const status = locked ? '🔒 Locked by you. Nobody can change picks.'
    : isLocked() ? `🔒 Locked since ${when(cutoff)}.`
      : cutoff ? `Picks lock ${when(cutoff)}. Games before then can’t be picked.`
        : 'No deadline. Each game closes at its own kickoff.';
  // Deadline choices: 30 minutes before every kickoff time still far enough ahead.
  const kickoffs = new Map();
  for (const g of state.games.filter((game) => game.start - LOCK_LEAD_MS > Date.now()).sort((a, b) => a.start - b.start)) {
    if (!kickoffs.has(g.start)) kickoffs.set(g.start, []);
    kickoffs.get(g.start).push(g);
  }
  const option = (id, label, sub, on) => `
    <button class="adm-opt ${on ? 'on' : ''}" data-action="admin-cutoff" data-id="${id}">${esc(label)}<small>${esc(sub)}</small></button>`;
  const options = [...kickoffs].map(([start, games]) => {
    const lock = start - LOCK_LEAD_MS;
    return option(lock, when(lock), `30 min before ${games.length === 1 ? games[0].matchup : `${games.length} games`}`, cutoff === lock);
  }).join('')
    + option('none', 'No deadline', 'Each game at kickoff', !cutoff);

  const rows = state.slip.members.map((m) => {
    const pick = picks()[m.id];
    return `
      <div class="adm-row">
        ${avatar(m, 28)}
        <span class="adm-who"><strong>${esc(m.name)}</strong><small>${pick ? `${esc(pretty(pick.label))} · ${esc(pick.matchup)}` : 'No pick'}</small></span>
        <button class="adm-btn" data-action="admin-act" data-id="${esc(m.id)}">${pick ? 'Change' : 'Pick for'}</button>
        ${pick ? `<button class="adm-btn danger" data-action="admin-remove" data-id="${esc(m.id)}">Remove</button>` : ''}
      </div>`;
  }).join('');

  return `
    <main class="who admin">
      <div class="cmp">
        <div class="card-head"><span>Pick deadline</span></div>
        <p class="adm-status">${esc(status)}</p>
        <div class="adm-opts">${options}</div>
        <button class="btn btn-block ${isLocked() ? 'btn-primary' : ''} adm-lock" data-action="${isLocked() ? 'admin-unlock' : 'admin-lock'}">${isLocked() ? 'Unlock picks' : 'Lock picks now'}</button>
      </div>
      <div class="cmp">
        <div class="card-head"><span>Picks</span><small>${Object.keys(picks()).length} of ${state.slip.members.length}</small></div>
        ${rows}
      </div>
      <a class="btn btn-ghost btn-block adm-board" href="${basePath}${esc(state.slipId)}">Open the board</a>
    </main>`;
}

// Shown while the admin picks for someone else.
export function renderActingBar() {
  if (!state.acting) return '';
  return `
    <div class="acting-bar">
      <span>Picking for <b>${esc(memberById(state.acting.id)?.name ?? '')}</b></span>
      <button class="adm-btn" data-action="acting-done">Done</button>
    </div>`;
}
