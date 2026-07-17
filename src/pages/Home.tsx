import { PageHeader, PageShell } from '../components/PageShell'

export default function Home() {
  return (
    <PageShell>
      <PageHeader title="FPL Analyser" subtitle="What matters this week — fixtures, form and captaincy, driven by the data" />
      <p className="text-ink-2">Coming in Phase 4.</p>
    </PageShell>
  )
}
