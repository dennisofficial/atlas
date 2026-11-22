import type { SessionStatusOutput } from '@dltech/atlas-protocol'

export const changesSignalOf = (status: SessionStatusOutput | undefined): string =>
  status === undefined ? 'no-status' : `${status.state}:${status.since ?? ''}`
