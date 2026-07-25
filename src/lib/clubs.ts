/** Per-club identity used by the stadium team-page banners: primary colour for
 *  the ambient tint plus home-ground name and capacity. Keyed by the short
 *  team codes used across site_data. */
export interface ClubInfo {
  color: string
  stadium: string
  capacity: number
}

export const CLUBS: Record<string, ClubInfo> = {
  ARS: { color: '#ef0107', stadium: 'Emirates Stadium', capacity: 60704 },
  AVL: { color: '#7a1e3c', stadium: 'Villa Park', capacity: 42918 },
  BHA: { color: '#0057b8', stadium: 'Amex Stadium', capacity: 31876 },
  BOU: { color: '#da291c', stadium: 'Vitality Stadium', capacity: 11307 },
  BRE: { color: '#e30613', stadium: 'Gtech Community Stadium', capacity: 17250 },
  CHE: { color: '#0a4595', stadium: 'Stamford Bridge', capacity: 40173 },
  COV: { color: '#59c6f5', stadium: 'Coventry Building Society Arena', capacity: 32609 },
  CRY: { color: '#1b458f', stadium: 'Selhurst Park', capacity: 25486 },
  EVE: { color: '#003399', stadium: 'Hill Dickinson Stadium', capacity: 52888 },
  FUL: { color: '#c6c9ce', stadium: 'Craven Cottage', capacity: 29600 },
  HUL: { color: '#f5a12d', stadium: 'MKM Stadium', capacity: 25400 },
  IPS: { color: '#3a64a3', stadium: 'Portman Road', capacity: 29813 },
  LEE: { color: '#ffcd00', stadium: 'Elland Road', capacity: 37645 },
  LIV: { color: '#c8102e', stadium: 'Anfield', capacity: 61276 },
  MCI: { color: '#6cabdd', stadium: 'Etihad Stadium', capacity: 53400 },
  MUN: { color: '#da291c', stadium: 'Old Trafford', capacity: 74310 },
  NEW: { color: '#bfc4cc', stadium: "St James' Park", capacity: 52305 },
  NFO: { color: '#dd0000', stadium: 'The City Ground', capacity: 30332 },
  SUN: { color: '#eb172b', stadium: 'Stadium of Light', capacity: 48707 },
  TOT: { color: '#8ea2c8', stadium: 'Tottenham Hotspur Stadium', capacity: 62850 },
}

export function clubInfo(team: string): ClubInfo | null {
  return CLUBS[team] ?? null
}
