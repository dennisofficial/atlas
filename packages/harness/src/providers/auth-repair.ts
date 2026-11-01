import { EProviderFailureKind } from '@dltech/atlas-core'

import { ModelAdmissionBlockedError } from '../model/admission-blocked'
import { causeChainOf } from '../model/cause-chain'
import { normalizeProviderFailure } from '../model/failure'

export const isConfirmedAuthRefusal = (error: unknown): boolean =>
  !causeChainOf(error).some((link) => link instanceof ModelAdmissionBlockedError) &&
  normalizeProviderFailure({ cause: error, nowMs: Date.now() }).kind === EProviderFailureKind.Auth
