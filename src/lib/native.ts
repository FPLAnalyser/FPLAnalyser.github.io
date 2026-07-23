// Native (Capacitor) shell integration. All of this is a no-op on the web —
// the dynamic imports only run inside the iOS / Android app, so the web bundle
// never pulls the plugins in.

type Cap = { isNativePlatform?: () => boolean }
const cap = () => (window as unknown as { Capacitor?: Cap }).Capacitor
export const isNative = () => !!cap()?.isNativePlatform?.()

export async function initNative() {
  if (!isNative()) return
  try {
    const [{ SplashScreen }, { StatusBar, Style }] = await Promise.all([
      import('@capacitor/splash-screen'),
      import('@capacitor/status-bar'),
    ])
    // Match the app's dark chrome, then reveal once React has mounted.
    try { await StatusBar.setStyle({ style: Style.Dark }) } catch { /* android/ios differences */ }
    await SplashScreen.hide()
  } catch {
    /* plugins absent — ignore */
  }
}
