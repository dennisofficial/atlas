import { ModelAdmissionBlockedError, causeChainOf } from '@dltech/atlas-agent'
import { EProviderFailureKind } from '@dltech/atlas-core'

import { normalizeProviderFailure } from './failure'

export const isConfirmedAuthRefusal = (error: unknown): boolean =>
  !causeChainOf(error).some((link) => link instanceof ModelAdmissionBlockedError) &&
  normalizeProviderFailure({ cause: error, nowMs: Date.now() }).kind === EProviderFailureKind.Auth
