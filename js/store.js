import { FIREBASE_DB_URL } from './config.js';

// Two interchangeable backends. Both store one JSON document per slip.
const localBackend = {
  mode: 'local',
  key: (id) => `parlay:slip:${id}`,
  async get(id) {
    const raw = localStorage.getItem(this.key(id));
    return raw ? JSON.parse(raw) : null;
  },
  async put(id, data, expectedRev) {
    const current = await this.get(id);
    if (current && current.rev !== expectedRev) return { conflict: true };
    localStorage.setItem(this.key(id), JSON.stringify(data));
    return { ok: true };
  },
  async remove(id) {
    localStorage.removeItem(this.key(id));
  },
};

// Firebase Realtime Database REST API. ETag + if-match gives a real compare-and-swap,
// so two friends saving at the same moment can't silently overwrite each other.
const firebaseBackend = {
  mode: 'firebase',
  etags: new Map(),
  url: (id) => `${FIREBASE_DB_URL.replace(/\/$/, '')}/slips/${encodeURIComponent(id)}.json`,
  async get(id) {
    const res = await fetch(this.url(id), { headers: { 'X-Firebase-ETag': 'true' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
    const etag = res.headers.get('ETag');
    if (etag) this.etags.set(id, etag);
    return res.json();
  },
  async put(id, data) {
    const etag = this.etags.get(id);
    const res = await fetch(this.url(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(etag ? { 'if-match': etag } : {}) },
      body: JSON.stringify(data),
    });
    if (res.status === 412) return { conflict: true };
    if (!res.ok) throw new Error(`Storage write failed (${res.status})`);
    this.etags.delete(id);
    return { ok: true };
  },
  async remove(id) {
    await fetch(this.url(id), { method: 'DELETE' });
  },
};

const backend = FIREBASE_DB_URL ? firebaseBackend : localBackend;
export const storageMode = backend.mode;

// Firebase drops empty objects, so normalize on every read.
function normalize(slip) {
  if (!slip) return null;
  slip.picks ??= {};
  slip.settings ??= {};
  slip.members = Object.values(slip.members ?? {});
  return slip;
}

export async function getSlip(id) {
  return normalize(await backend.get(id));
}

export async function createSlip(id, data) {
  const slip = { ...data, id, rev: 1, createdAt: Date.now(), updatedAt: Date.now() };
  await backend.put(id, slip, undefined);
  return slip;
}

// Read the latest slip, let `mutate` validate and edit it, then write it back only if
// nobody else saved in between. Retries on a lost race; `mutate` re-runs on fresh data.
export async function updateSlip(id, mutate) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await getSlip(id);
    if (!current) throw new Error('This slip no longer exists.');
    const next = structuredClone(current);
    mutate(next);
    next.rev = (current.rev ?? 0) + 1;
    next.updatedAt = Date.now();
    const result = await backend.put(id, next, current.rev);
    if (result.ok) return next;
  }
  throw new Error('Lots of people saving at once. Try again.');
}

export const deleteSlip = (id) => backend.remove(id);

// Polls for changes. Local mode also listens for edits from other tabs.
export function watchSlip(id, onChange, intervalMs = 4000) {
  let lastRev = null;
  const check = async () => {
    try {
      const slip = await getSlip(id);
      if (slip?.rev !== lastRev) {
        lastRev = slip?.rev ?? null;
        onChange(slip);
      }
    } catch {
      // Network blip; the next poll will catch up.
    }
  };
  const timer = setInterval(check, intervalMs);
  const onStorage = (e) => e.key === localBackend.key(id) && check();
  window.addEventListener('storage', onStorage);
  check();
  return () => {
    clearInterval(timer);
    window.removeEventListener('storage', onStorage);
  };
}

