import type { DigestTimings } from '@dltech/atlas-control'

/** Flattens a digest read's phase timings into event properties. */
export const digestTimingProperties = (timings: DigestTimings): Record<string, number> => ({
  transaction_ms: timings.phases.transactionMs,
  digest_rows_ms: timings.phases.digestRowsMs,
  threads_ms: timings.phases.threadsMs,
  views_ms: timings.phases.viewsMs,
  leases_ms: timings.phases.leasesMs,
  pull_requests_ms: timings.phases.pullRequestsMs,
  rows_ms: timings.phases.rowsMs,
  stale_rows: timings.staleRows,
  stale_ms: timings.staleMs,
})
