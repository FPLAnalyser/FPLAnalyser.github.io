/* ════════════════════════════════════════════════════════════════════════
   The FA monogram.

   Served from our own origin rather than inlined, so the export canvas can
   read its pixels back — a mark fetched cross-origin taints the canvas and
   the whole share fails. Same reason it is a real <img> and not a CSS
   background: html2canvas draws images, not backgrounds.

   The file carries its own alpha, so it sits on the cream surface and the
   near-black one without a plate behind it.
   ════════════════════════════════════════════════════════════════════════ */

/** Path from the deployed root — the site is served from a sub-path on
 *  GitHub Pages, so this has to go through the bundler's base URL. */
export const MARK_SRC = `${import.meta.env.BASE_URL}brand/mark.png`

/** `size` fixes the box in pixels; leave it off and size from `className`
 *  instead — an inline width beats any class, so passing both would pin the
 *  mark at one size and quietly ignore the responsive rule. */
export function BrandMark({ size, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src={MARK_SRC}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 select-none ${className}`}
      style={size ? { width: size, height: size, objectFit: 'contain' } : { objectFit: 'contain' }}
      draggable={false}
    />
  )
}
