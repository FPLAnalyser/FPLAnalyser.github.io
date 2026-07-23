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

/** A light tap of haptic feedback — no-op on the web. Fire-and-forget. */
export function tapHaptic(kind: 'light' | 'medium' | 'select' = 'light') {
  if (!isNative()) return
  import('@capacitor/haptics')
    .then(({ Haptics, ImpactStyle }) => {
      if (kind === 'select') return Haptics.selectionChanged()
      return Haptics.impact({ style: kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light })
    })
    .catch(() => {})
}

/**
 * Share an image via the OS share sheet. On native we write the PNG to the
 * cache and hand its URI to @capacitor/share; on the web we return false so the
 * caller keeps its existing navigator.share / download path.
 */
export async function shareImageNative(blob: Blob, fileName: string, title: string): Promise<boolean> {
  if (!isNative()) return false
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])
    const base64 = await blobToBase64(blob)
    const w = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache })
    await Share.share({ title, url: w.uri })
    return true
  } catch {
    return false
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}
