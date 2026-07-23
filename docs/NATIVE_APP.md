# FPL Analyser — native app (iOS & Android)

The web app is wrapped with [Capacitor](https://capacitorjs.com). The web build
in `dist/` is bundled into the native app so it launches offline, and the data
layer fetches the **published** `site_data` first at runtime (see
`src/lib/data.ts`), so ratings stay fresh without shipping a new app version.

Capacitor loads the existing Vite build inside a native WebView, so one codebase
serves the browser, the installed PWA, and the store apps — no rewrite. Hash
routing, the relative `base: './'`, the static (no-SSR) build and the
DOM-free logic modules all already suit this.

Everything below runs on **your Mac** — native builds need Xcode / Android
Studio, which can't run in the cloud sandbox.

## One-time setup

**Accounts (paid):**
- Apple: [Apple Developer Program](https://developer.apple.com/programs/) — **$99/year** (required to ship to the App Store).
- Google: [Play Console](https://play.google.com/console/signup) — **$25 once**.

**Tools:**
- **Xcode** (Mac App Store) + `sudo gem install cocoapods` — for iOS.
- **Android Studio** (with an SDK + a virtual device) — for Android.
- Node 18+.

## Generate the native projects (once)

```bash
cd ~/Desktop/fpl-analyser
git pull origin main
npm install                 # pulls in the Capacitor packages
npm run build               # produce dist/
npx cap add ios             # creates the ios/ project
npx cap add android         # creates the android/ project
```

Commit the generated `ios/` and `android/` folders — they hold your signing and
native config.

## App icon & splash screen

Drop a 1024×1024 PNG at `resources/icon.png` (and optionally
`resources/splash.png`, 2732×2732), then:

```bash
npm i -D @capacitor/assets
npx @capacitor/assets generate --iconBackgroundColor '#0c0b09' --splashBackgroundColor '#0c0b09'
```

This writes every required icon/splash size into both platforms. The existing
`public/icons/` art is a good source.

## Build & run each release

```bash
npm run app:ios       # build web + sync + open Xcode
npm run app:android   # build web + sync + open Android Studio
```

- **iOS (Xcode):** pick your Team under *Signing & Capabilities*, confirm the
  bundle id `com.fplanalyser.app`, then Run on a simulator or device. To submit:
  *Product → Archive → Distribute App → App Store Connect*.
- **Android (Android Studio):** *Build → Generate Signed Bundle / APK → Android
  App Bundle (.aab)*, then upload the `.aab` in the Play Console.

## Updating the app

- **Data changes** (the pipeline pushing new `site_data`): appear **automatically**
  — the app fetches live data, no release needed.
- **Web/feature changes** (new pages, fixes in this repo): the web bundle is
  frozen in the shipped app, so re-run `npm run app:sync`, rebuild in
  Xcode/Android Studio, and submit an update.

> Alternative: set `server.url` in `capacitor.config.ts` to the live site so web
> changes appear instantly without a resubmit. Simpler to maintain, but Apple
> sometimes rejects apps that are just a remote website, so the default here
> bundles the web build (safer for review). Ask and I'll switch it.

## What's already wired
- `capacitor.config.ts` — appId `com.fplanalyser.app`, `webDir: dist`, dark
  theme, `CapacitorHttp` enabled (native requests bypass CORS).
- `src/lib/native.ts` — hides the splash screen and sets the status-bar style on
  launch (no-op on the web).
- `src/lib/data.ts` — fetches the published data first when running natively.
- npm scripts: `app:sync`, `app:ios`, `app:android`.

## Follow-up worth doing for "My Team"
In the browser, live FPL data goes through public CORS proxies in
`src/lib/api.ts` (the FPL API sends no CORS headers). With `CapacitorHttp`
enabled, native requests are **not** subject to CORS, so in the native build
`fplFetch` can hit `https://fantasy.premierleague.com/api/...` directly — drop
the proxy chain when `Capacitor.isNativePlatform()`, keeping the proxy only for
the web. Faster and more reliable "My Team" in the app. (Deferred: My Team is
disabled pre-season anyway.)
