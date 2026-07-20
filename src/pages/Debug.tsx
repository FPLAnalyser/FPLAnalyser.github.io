import { useEffect, useState } from 'react'
import { PageHeader, PageShell } from '../components/PageShell'

declare const __BUILD_TIME__: string

declare global {
  interface Window {
    __errlog?: string[]
  }
}

interface Probe { name: string; status: string; ms: number; kb: number | null }

/**
 * Field diagnostics (#/debug, not linked from nav): everything needed to see
 * WHY the site is slow or failing on a specific device, in one screenshot —
 * build stamp, service-worker state, cache contents, live fetch probes with
 * timings, connection info, and any runtime errors collected since page load.
 */
export default function Debug() {
  const [swInfo, setSwInfo] = useState<string[]>(['checking…'])
  const [cacheKeys, setCacheKeys] = useState<string[]>(['checking…'])
  const [probes, setProbes] = useState<Probe[]>([])
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const lines: string[] = []
      lines.push(`controller: ${navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL.split('/').pop() : 'NONE (page not SW-controlled)'}`)
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => {
          if (!regs.length) lines.push('registrations: none')
          regs.forEach((reg) => {
            const sw = reg.active || reg.waiting || reg.installing
            lines.push(`reg: ${sw ? sw.scriptURL.split('/').pop() : '?'} · state=${sw?.state ?? '?'} · scope=${reg.scope}`)
          })
          setSwInfo([...lines])
        })
        .catch((e) => setSwInfo([...lines, `getRegistrations failed: ${e}`]))
    } else {
      setSwInfo(['serviceWorker unsupported'])
    }
    if ('caches' in window) {
      caches.keys().then((keys) => setCacheKeys(keys.length ? keys : ['(no caches)'])).catch((e) => setCacheKeys([`caches.keys failed: ${e}`]))
    } else {
      setCacheKeys(['Cache API unsupported'])
    }
  }, [])

  const runProbes = async () => {
    setProbing(true)
    const targets = ['site_data/meta.json', 'site_data/ratings.json', 'site_data/season_to_date.json', 'sw.js', 'manifest.webmanifest']
    const out: Probe[] = []
    for (const t of targets) {
      const t0 = performance.now()
      try {
        const r = await fetch(`${t}${t.includes('?') ? '&' : '?'}probe=${Date.now()}`, { cache: 'no-store' })
        const body = await r.arrayBuffer()
        out.push({ name: t, status: String(r.status), ms: Math.round(performance.now() - t0), kb: Math.round(body.byteLength / 1024) })
      } catch (e) {
        out.push({ name: t, status: `FAIL: ${e instanceof Error ? e.message : e}`, ms: Math.round(performance.now() - t0), kb: null })
      }
      setProbes([...out])
    }
    setProbing(false)
  }

  const conn = (navigator as { connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean } }).connection
  const errlog = window.__errlog ?? []

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-4">
      <div className="mb-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">{title}</div>
      <div className="rounded-lg border border-line bg-surface-1 p-3 font-num text-[12px] leading-relaxed break-all whitespace-pre-wrap text-ink-2">{children}</div>
    </div>
  )

  return (
    <PageShell>
      <PageHeader title="Diagnostics" subtitle="Screenshot this whole page when reporting a loading problem" />

      <Section title="Build">
        {`built: ${__BUILD_TIME__}\nurl: ${location.href}\nua: ${navigator.userAgent}`}
        {conn ? `\nconnection: ${conn.effectiveType ?? '?'} · downlink ${conn.downlink ?? '?'}Mbps · rtt ${conn.rtt ?? '?'}ms · saveData ${conn.saveData ?? false}` : '\nconnection: (API unavailable)'}
      </Section>

      <Section title="Service worker">{swInfo.join('\n')}</Section>
      <Section title="Caches">{cacheKeys.join('\n')}</Section>

      <div className="mb-4">
        <button
          onClick={runProbes}
          disabled={probing}
          className="min-h-11 rounded-lg bg-accent px-5 font-semibold text-accent-contrast transition-colors hover:bg-accent-strong disabled:opacity-50"
        >
          {probing ? 'Testing…' : 'Run network test'}
        </button>
      </div>
      {probes.length > 0 && (
        <Section title="Network test (bypasses all caches)">
          {probes.map((p) => `${p.name}  →  ${p.status}${p.kb != null ? ` · ${p.kb}KB` : ''} · ${p.ms}ms`).join('\n')}
        </Section>
      )}

      <Section title="Errors this session">{errlog.length ? errlog.join('\n') : '(none recorded)'}</Section>
    </PageShell>
  )
}
