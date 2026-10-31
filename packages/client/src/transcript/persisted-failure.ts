import type { Event } from '@dltech/atlas-core'

import { legacyFailureOf } from './run-failure'
import type { StepFailure } from './transcript-snapshot'

export function persistedFailureOf(events: readonly Event[]): StepFailure | null {
  const legacy = legacyFailureOf(events)
  return legacy === null ? null : { message: legacy.message, failure: null, runId: null }
}
