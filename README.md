# Parlay Pool

A weekly group parlay for a Sleeper league. Each member picks one leg from this week's NFL lines. The app blocks duplicate or opposing legs and shows the combined parlay.

No build step. Plain HTML, CSS, and ES modules.

## Run locally

```bash
python3 serve.py
```

Open http://localhost:5173/<leagueId>, for example http://localhost:5173/1365380346513723392. `serve.py` serves `index.html` for league paths. On GitHub Pages, `404.html` (a copy of `index.html`) does the same job, so keep the two files in sync.

Slips are shared through Firebase, so everyone in the league sees the same picks.

## How it works

- **Routes:** `/` asks for a league ID. `/<leagueId>` is that league's slip. Everyone in the league can pick.
- **Weeks:** the first visit creates the slip. The first visit after the week ends (Tuesday 10:00 UTC) clears picks and reloads members.
- **Lines:** `GET https://api.sleeper.app/predictions/events/lobby` gives each NFL game (moneyline) plus its main spread and total. `GET /predictions/events?ids=...` gives every alternate line. Prices are cents; the UI shows American odds.
- **Conflicts:** one leg per game and bet type (moneyline, spread, total).
- **Saving:** every save reads the latest slip, re-checks conflicts, then writes.
- **Admin:** open `/<leagueId>?admin` and enter the password (its SHA-256 is `ADMIN_PASSWORD_SHA256` in `js/config.js`). Set a pick deadline at any kickoff time, lock or unlock picks, remove picks, or pick for someone. Games that kick off before the deadline can't be picked, and moving the deadline later removes picks on those games. Picks lock on their own when the deadline passes. This keeps casual visitors out; it is not real security.
- **Demo:** add `?demo` to a league URL to fill in picks for half the league, so you can try different states.

## Hosting

GitHub Pages serves the repository root from the `main` branch. There is no build step, so a push is a deploy.

## Storage

Slips live in a Firebase Realtime Database (`FIREBASE_DB_URL` in `js/config.js`), one document per league at `/slips/<leagueId>`. Saves use ETag compare-and-swap. Open pages get changes pushed over Server-Sent Events, with a 60-second fallback check. Database rules only allow numeric league paths with `league` and `week` fields. `?demo` always uses this browser's localStorage, so fake picks never reach the shared slip. Leave `FIREBASE_DB_URL` empty to run fully local.
