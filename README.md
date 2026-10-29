# Parlay Pool

A weekly group parlay for a Sleeper league. Each member picks one leg from this week's NFL lines. The app blocks duplicate or opposing legs and shows the combined parlay.

No build step. Plain HTML, CSS, and ES modules.

## Run locally

```bash
python3 serve.py
```

Open http://localhost:5173/<leagueId>, for example http://localhost:5173/1365380346513723392. `serve.py` serves `index.html` for league paths. On GitHub Pages, `404.html` (a copy of `index.html`) does the same job, so keep the two files in sync.

Slips are saved in this browser's localStorage for now. Open two tabs to act as two friends.

## How it works

- **Routes:** `/` asks for a league ID. `/<leagueId>` is that league's slip. Everyone in the league can pick.
- **Weeks:** the first visit creates the slip. The first visit after the week ends (Tuesday 10:00 UTC) clears picks and reloads members.
- **Lines:** `GET https://api.sleeper.app/predictions/events/lobby` gives each NFL game (moneyline) plus its main spread and total. `GET /predictions/events?ids=...` gives every alternate line. Prices are cents; the UI shows American odds.
- **Conflicts:** one leg per game and bet type (moneyline, spread, total).
- **Saving:** every save reads the latest slip, re-checks conflicts, then writes.
- **Demo:** add `?demo` to a league URL to fill in picks for half the league, so you can try different states.

## Hosting

GitHub Pages serves the repository root from the `main` branch. There is no build step, so a push is a deploy.

## Storage

Not decided yet. `js/store.js` has a localStorage backend and a Firebase REST backend behind one interface, so a new backend only needs `get`, `put`, and `remove`.
