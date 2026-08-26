/** Minimal static server with SPA fallback. The site uses a hash router, so
 *  everything resolves off index.html; the fallback is here for asset paths. */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.webm': 'video/webm', '.mp4': 'video/mp4',
}

export function serve(root, port) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    let file = path.join(root, url)
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html') }
    catch { file = path.join(root, 'index.html') }
    if (!fs.existsSync(file)) file = path.join(root, 'index.html')
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || '.'
  const port = Number(process.argv[3] || 4179)
  await serve(root, port)
  console.log(`serving ${root} on http://127.0.0.1:${port}`)
}
