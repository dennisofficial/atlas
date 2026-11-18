import { EProviderFailureKind, EProviderRetry } from '@dltech/atlas-core'

import { normalizeProviderFailure } from '../failure'

export const NOW_MS = Date.parse('2026-10-31T12:00:00.000Z')

export const normalized = (cause: unknown, nowMs: number = NOW_MS) =>
  normalizeProviderFailure({ cause, nowMs })

export const transient = (kind: EProviderFailureKind) => ({ kind, retry: EProviderRetry.Transient })

export const never = (kind: EProviderFailureKind) => ({ kind, retry: EProviderRetry.Never })
