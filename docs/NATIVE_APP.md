# Shipping FPL Analyser as a native app (later)

The rebuilt frontend is a pure static SPA (React + Vite, hash-routed, relative
asset/data paths, no server dependency). That means it can be wrapped as an
iOS/Android app with **[Capacitor](https://capacitorjs.com/)** with no rewrite —
the web app *is* the app. Nothing here needs doing now; this note records the
path so it's written down.

## Why Capacitor (not React Native)

React Native would mean rebuilding the entire UI a second time. Capacitor
instead loads the existing Vite build inside a native WebView, so one codebase
serves the browser, the installed PWA, and the store apps. The pieces that make
this work are already in place:

- **Hash routing** works from a `file://`-style WebView with zero config.
- **Relative base** (`base: './'` in `vite.config.ts`) — no absolute-origin assumptions.
- **No SSR / no backend** — Capacitor requires a static bundle, which this is.
- **Pure logic modules** (`src/lib/api.ts`, `data.ts`, `insights/*`, `shotzones.ts`)
  are free of DOM/React imports, so a native HTTP layer can be swapped in cleanly.
- The **PWA manifest + icons** (`public/manifest.webmanifest`, `public/icons/`)
  double as app-icon/splash source material.

## Steps when you want to build it

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "FPL Analyser" com.fplanalyser.app --web-dir dist
npm run build
npx cap add ios       # and/or: npx cap add android
npx cap copy
npx cap open ios      # opens Xcode / Android Studio to build & submit
```

## The one thing worth changing for the app

In the browser, live FPL data is fetched through public CORS proxies
(`corsproxy.io` → `allorigins.win`) in `src/lib/api.ts`, because the FPL API
sends no CORS headers. **Native requests are not subject to CORS**, so in the
Capacitor build you can swap `fplFetch` to use
[`@capacitor/http`](https://capacitorjs.com/docs/apis/http) (or the community
`CapacitorHttp`) and hit `https://fantasy.premierleague.com/api/...` directly.
That removes the proxy dependency entirely and makes "My Team" faster and more
reliable in the app. Gate it with `Capacitor.isNativePlatform()` so the web
build keeps using the proxy chain.
