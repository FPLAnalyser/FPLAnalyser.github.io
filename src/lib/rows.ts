// Typed accessors for the heterogeneous site_data rows (per-position objects
// carry different keys, so most lookups are dynamic).
import type { Row } from './types'

export function num(r: Row, key: string): number | null {
  const v = r[key]
  return typeof v === 'number' && !isNaN(v) ? v : null
}

export function str(r: Row, key: string): string | null {
  const v = r[key]
  return typeof v === 'string' ? v : null
}

export function bool(r: Row, key: string): boolean {
  return r[key] === true
}
