// Brand tokens and font loading for the motion-graphics layer.
//
// The values mirror src/index.css so the cards cut against the filmed product
// without a visible seam. If the site's palette moves, move these with it.

import React, { useEffect, useState } from 'react'
import { delayRender, continueRender, staticFile } from 'remotion'

export const GOLD = '#c9a227'
export const GOLD_2 = '#ead188'
export const INK = '#0c0b09'
export const PAPER = '#ffffff'

export const DISPLAY = "'ArchivoBlack', system-ui, sans-serif"
export const BODY = "'Manrope', system-ui, sans-serif"

const FACE_CSS = `
@font-face { font-family:'Manrope'; font-weight:800; font-display:block;
  src:url('${staticFile('fonts/manrope-800.woff2')}') format('woff2'); }
@font-face { font-family:'ArchivoBlack'; font-weight:400; font-display:block;
  src:url('${staticFile('fonts/archivo-black-400.woff2')}') format('woff2'); }
`

/**
 * Blocks the render until the brand faces are actually loaded. Without this,
 * Remotion will happily rasterise the first frames in a fallback font and the
 * type will pop mid-shot — the kind of defect that only shows up in the file.
 */
export const BrandFonts: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('loading brand fonts'))

  useEffect(() => {
    let cancelled = false
    Promise.all([
      document.fonts.load('800 40px Manrope'),
      document.fonts.load('400 40px ArchivoBlack'),
    ])
      .then(() => document.fonts.ready)
      .then(() => { if (!cancelled) continueRender(handle) })
      // Never hang the render on a font that will not arrive.
      .catch(() => { if (!cancelled) continueRender(handle) })
    return () => { cancelled = true }
  }, [handle])

  return (
    <>
      <style>{FACE_CSS}</style>
      {children}
    </>
  )
}
