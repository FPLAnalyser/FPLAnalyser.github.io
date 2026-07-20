# FPL Analyser

Data-driven Fantasy Premier League analysis — player & team ratings, scouting
percentiles, shot maps, and a personalised weekly report for your own squad.

The site is a **React + Vite + TypeScript** single-page app (Tailwind CSS,
Framer Motion), served as a PWA. It reads the pre-computed tables in
`site_data/*.json` produced by the Python pipeline — the pipeline and
`build_site_data.py` are unchanged by the frontend.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173  (serves site_data/ from the repo root)
npm run build      # type-checks, builds to dist/, copies site_data/ + generates the service worker
npm run preview    # serve the production build locally
```

- **Themes:** three accents (Aurum / Frost / Verdant) × light/dark, chosen from
  the nav and persisted to `localStorage`; first visit follows the OS preference.
- **Data:** `src/lib/data.ts` fetches `site_data/<name>.json` (falling back to the
  published `main` branch). Big tables (shots, scouting) load lazily.
- **Live "My Team":** talks to the FPL API through public CORS proxies (the API
  sends no CORS headers). See `docs/NATIVE_APP.md` for removing that dependency
  in a future Capacitor app build.

## Deploy (GitHub Pages via Actions)

`.github/workflows/deploy.yml` builds the app and publishes `dist/` to GitHub
Pages on every push to `main` (including the Python pipeline's data commits, so a
fresh `site_data` drop republishes automatically).

> **One-time setup:** in the repo's **Settings → Pages**, set **Source** to
> **GitHub Actions**. Until this is switched from the old "Deploy from a branch",
> Pages will keep serving raw source instead of the built app.

The Python data pipeline (`automation/run_pipeline.sh`) still commits to `main`
as before; it just triggers the build now instead of serving files directly.
