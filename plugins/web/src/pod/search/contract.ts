import type { WebSearchResult } from '@dltech/atlas-core'

export enum EFreshness {
  Hour = 'hour',
  Day = 'day',
  Week = 'week',
  Month = 'month',
  Year = 'year',
}

export type SearchRequest = {
  query: string
  count: number
  signal: AbortSignal
  site?: string | undefined
  fresh?: EFreshness | undefined
  gl?: string | undefined
}

export type SearchOutcome =
  | { ok: true; results: readonly WebSearchResult[] }
  | { ok: false; reason: string }

export type SearchPort = {
  search(request: SearchRequest): Promise<SearchOutcome>
}
