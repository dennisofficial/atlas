import {
  EProviderFailureKind,
  ERunFailureKind,
  runFailureKindOfProviderKind,
  type RunFailure,
} from '@dltech/atlas-core'

import { causeChainOf } from './cause-chain'
import { normalizeProviderFailure } from './failure'
import { safeFailureMessage } from './safe-failure-message'
import { TurnFault } from './turn-fault'

export { safeFailureMessage }

const typedKindOf = (cause: unknown): ERunFailureKind | undefined => {
  for (const link of causeChainOf(cause)) {
    if (link instanceof TurnFault) return link.kind
  }
  return undefined
}

export function runFailureOf(args: {
  message: string
  cause: unknown
  providerId?: string | undefined
  modelId?: string | undefined
  escaped?: boolean | undefined
  nowMs?: number | undefined
}): RunFailure {
  const normalized = normalizeProviderFailure({
    cause: args.cause,
    message: args.message,
    providerId: args.providerId,
    modelId: args.modelId,
    nowMs: args.nowMs ?? Date.now(),
  })

  const classified = runFailureKindOfProviderKind(normalized.kind)
  const unexplained = normalized.kind === EProviderFailureKind.Other && args.escaped === true
  const kind = typedKindOf(args.cause) ?? (unexplained ? ERunFailureKind.Crashed : classified)

  const providerId = normalized.providerId ?? args.providerId
  const modelId = normalized.modelId ?? args.modelId
  return {
    kind,
    message: safeFailureMessage(args.message),
    ...(normalized.statusCode === undefined ? {} : { statusCode: normalized.statusCode }),
    ...(normalized.providerCode === undefined ? {} : { providerCode: normalized.providerCode }),
    ...(providerId === undefined ? {} : { providerId }),
    ...(modelId === undefined ? {} : { modelId }),
    ...(normalized.accountId === undefined ? {} : { accountId: normalized.accountId }),
    ...(normalized.retryAt === undefined ? {} : { retryAt: normalized.retryAt }),
    ...(normalized.resetAt === undefined ? {} : { resetAt: normalized.resetAt }),
  }
}
