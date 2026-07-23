import type { CapacitorConfig } from '@capacitor/cli'

// Native (iOS / Android) wrapper for the FPL Analyser web app. The web build in
// `dist/` is bundled into the app (so it launches offline), but the data layer
// fetches the published site_data first at runtime, so ratings stay fresh
// without an app-store release (see src/lib/data.ts).
const config: CapacitorConfig = {
  appId: 'com.fplanalyser.app',
  appName: 'FPL Analyser',
  webDir: 'dist',
  backgroundColor: '#0c0b09',
  ios: {
    backgroundColor: '#0c0b09',
    contentInset: 'always',
  },
  android: {
    backgroundColor: '#0c0b09',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#0c0b09',
      showSpinner: false,
    },
    // Route native fetch/XHR through the OS HTTP stack, which is NOT subject to
    // CORS — so the app can call the FPL API and the published data directly,
    // no proxy needed (the browser build is unaffected).
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
