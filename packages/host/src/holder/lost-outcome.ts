import { EHeldOutcome } from '@dltech/atlas-core'

import type { LeaseLostError } from './record/lease-lost-error'

const STORE_REFUSALS: ReadonlySet<string> = new Set(['retry-exhausted', 'store-error'])

export const lostOutcome = (error: LeaseLostError): EHeldOutcome =>
  STORE_REFUSALS.has(error.refusal) ? EHeldOutcome.Faulted : EHeldOutcome.Fenced
