import { EProviderFailureKind } from '@dltech/atlas-core'

import { normalizeProviderFailure } from '../model/failure'

export const isConfirmedAuthRefusal = (error: unknown): boolean =>
  normalizeProviderFailure({ cause: error, nowMs: Date.now() }).kind === EProviderFailureKind.Auth
