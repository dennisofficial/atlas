import type { FetchedPage } from '@dltech/atlas-core'

import type { EPageFormat } from '../fetch-page'

export type ReadArgs = {
  url: string
  format: EPageFormat
  signal: AbortSignal
  timeoutSeconds?: number | undefined
  selector?: string | undefined
  remove?: string | undefined
  waitFor?: string | undefined
  render?: boolean | undefined
  page?: number | undefined
}

export type ReadOutcome =
  | { kind: 'page'; page: FetchedPage }
  | { kind: 'failed'; reason: string }
  | { kind: 'unavailable'; reason: string }

export type ReaderPort = {
  read(args: ReadArgs): Promise<ReadOutcome>
}
