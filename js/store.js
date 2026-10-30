import { FIREBASE_DB_URL } from './config.js';

// Two interchangeable backends. Both store one JSON document per slip, and both do
// compare-and-swap: `get` returns the document with a version, and `put` with that
// version only succeeds if nobody saved in between.
const localBackend = {
  key: (id) => `parlay:slip:${id}`,
  async get(id) {
    const raw = localStorage.getItem(this.key(id));
    const data = raw ? JSON.parse(raw) : null;
    return { data, version: data?.rev ?? null };
  },
  async put(id, data, version) {
    const { version: current } = await this.get(id);
    if (current !== version) return { conflict: true };
    localStorage.setItem(this.key(id), JSON.stringify(data));
    return { ok: true };
  },
};

// Firebase Realtime Database REST API. The version is the read's ETag, sent back as
// if-match, so two friends saving at the same moment can't overwrite each other.
const firebaseBackend = {
  url: (id) => `${FIREBASE_DB_URL.replace(/\/$/, '')}/slips/${encodeURIComponent(id)}.json`,
  async get(id) {
    const res = await fetch(this.url(id), { headers: { 'X-Firebase-ETag': 'true' }, cache: 'no-store', signal: timeout() });
    if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
    const version = res.headers.get('ETag');
    if (!version) throw new Error('Storage read failed (no ETag)');
    return { data: await res.json(), version };
  },
  async put(id, data, version) {
    const res = await fetch(this.url(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': version },
      body: JSON.stringify(data),
      signal: timeout(),
    });
    if (res.status === 412) return { conflict: true };
    if (!res.ok) throw new Error(`Storage write failed (${res.status})`);
    return { ok: true };
  },
};

// A hung request would leave a pick spinning forever; give up after 10 seconds.
const timeout = () => AbortSignal.timeout?.(10_000);

// ?demo fills in fake picks, so it always runs on this browser's own copy and never
// touches the league's shared slip.
const demo = new URLSearchParams(location.search).has('demo');
const backend = FIREBASE_DB_URL && !demo ? firebaseBackend : localBackend;

// Firebase drops empty objects, so fill them back in on every read. The database rules
// only check the top-level fields, so a malformed pick or member is dropped or fixed
// here rather than breaking the page for the whole league.
const validPick = (p) => p && typeof p.optKey === 'string' && typeof p.label === 'string'
  && typeof p.matchup === 'string' && p.matchup.includes(' @ ')
  && Number.isFinite(p.start) && Number.isFinite(p.price);
function normalize(slip) {
  if (!slip || typeof slip !== 'object') return null;
  slip.settings ??= {};
  slip.picks = Object.fromEntries(Object.entries(slip.picks ?? {}).filter(([, p]) => validPick(p)));
  slip.members = Object.values(slip.members ?? {})
    .filter((m) => m?.id)
    .map((m) => ({ ...m, id: String(m.id), name: String(m.name ?? 'Unknown') }));
  return slip;
}

export async function getSlip(id) {
  return normalize((await backend.get(id)).data);
}

// Creates the slip unless someone else just did; returns whichever slip won.
export async function createSlip(id, data) {
  const { data: existing, version } = await backend.get(id);
  if (existing) return normalize(existing);
  const slip = { ...data, id, rev: 1, createdAt: Date.now(), updatedAt: Date.now() };
  const result = await backend.put(id, slip, version);
  return result.ok ? normalize(slip) : getSlip(id);
}

// Read the latest slip, let `mutate` validate and edit it, then write it back only if
// nobody else saved in between. Retries on a lost race; `mutate` re-runs on fresh data.
// `mutate` returns false when there is nothing to change, and nothing is written.
export async function updateSlip(id, mutate) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, version } = await backend.get(id);
    const current = normalize(data);
    if (!current) throw new Error('This slip no longer exists.');
    const next = structuredClone(current);
    if (mutate(next) === false) return current;
    next.rev = (current.rev ?? 0) + 1;
    next.updatedAt = Date.now();
    const result = await backend.put(id, next, version);
    if (result.ok) return next;
  }
  throw new Error('Lots of people saving at once. Try again.');
}

// Watches for changes. With Firebase, the database pushes each change over one open
// connection (Server-Sent Events), so there is no steady polling: a full-document push
// is used as is, and a partial one triggers a read. While the connection is down, a
// slow check (plus one whenever the tab comes back into view) keeps up. Local mode
// listens for edits from other tabs. Only newer revisions are passed on, so a slow
// read can't undo a newer push.
export function watchSlip(id, onChange, fallbackMs = 60_000) {
  let lastRev = null;
  let seen = false;
  const apply = (slip) => {
    const rev = slip?.rev ?? null;
    if (seen && (rev === lastRev || (rev !== null && lastRev !== null && rev < lastRev))) return;
    seen = true;
    lastRev = rev;
    onChange(slip);
  };
  let reading = null;
  const check = () => {
    // Checks that arrive while one is in flight share its result.
    reading ??= getSlip(id).then(apply, () => { /* network blip; the next push or check catches up */ })
      .finally(() => (reading = null));
    return reading;
  };
  const stream = backend === firebaseBackend ? new EventSource(firebaseBackend.url(id)) : null;
  const streaming = () => stream?.readyState === EventSource.OPEN;
  const visible = () => document.visibilityState === 'visible';
  const timer = setInterval(() => visible() && !streaming() && check(), fallbackMs);
  const onVisible = () => visible() && check();
  document.addEventListener('visibilitychange', onVisible);
  const onStorage = (e) => e.key === localBackend.key(id) && check();
  window.addEventListener('storage', onStorage);
  // EventSource reconnects on its own after a network drop.
  stream?.addEventListener('put', (e) => {
    try {
      const { path, data } = JSON.parse(e.data);
      if (path === '/') return apply(normalize(data));
    } catch { /* fall through to a read */ }
    check();
  });
  stream?.addEventListener('patch', check);
  check();
  return () => {
    clearInterval(timer);
    stream?.close();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('storage', onStorage);
  };
}
