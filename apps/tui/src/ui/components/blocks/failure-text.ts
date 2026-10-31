import {
  runAttentionCopy,
  type RunAttention,
  type RunAttentionRemedy,
} from '@dltech/atlas-client/transcript'
import { ERunFailureKind, ERunRemedy, providerLabelOf } from '@dltech/atlas-core'

import type { StepFailure } from '../../../store'

const FAILURE_WITHOUT_A_REASON = 'The model reported no reason.'

export type FailureView = {
  title?: string
  message: string
  remedies: readonly RunAttentionRemedy[]
  busyReason: string | null
}

export const isResumeOnly = (attention: RunAttention | null): boolean =>
  attention !== null &&
  attention.failure === null &&
  attention.remedies.length > 0 &&
  attention.remedies.every((entry) => entry.remedy === ERunRemedy.Resume)

export const failureView = (args: {
  failure: StepFailure
  attention: RunAttention | null
  accountLabel: string | undefined
}): FailureView => {
  const { failure, attention, accountLabel } = args
  if (attention === null || isResumeOnly(attention)) {
    return {
      message: failure.message ?? FAILURE_WITHOUT_A_REASON,
      remedies: [],
      busyReason: null,
    }
  }
  const copy = runAttentionCopy({
    attention,
    providerLabel: providerLabelOf(attention.failure?.providerId),
    accountLabel,
  })
  const legacy = attention.failure === null
  return {
    ...(legacy ? {} : { title: copy.title }),
    message: legacy ? (failure.message ?? attention.message) : copy.detail,
    remedies: attention.remedies,
    busyReason: attention.busyReason,
  }
}

export const isAgentFailed = (attention: RunAttention | null): attention is RunAttention =>
  attention?.failure?.kind === ERunFailureKind.AgentFailed

export const agentFailureView = (attention: RunAttention): FailureView => {
  const copy = runAttentionCopy({ attention })
  return {
    title: copy.title,
    message: copy.detail,
    remedies: attention.remedies,
    busyReason: attention.busyReason,
  }
}
