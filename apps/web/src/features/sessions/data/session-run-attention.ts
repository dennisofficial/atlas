import type { RunAttention } from '@dltech/atlas-client/transcript'
import { BUSY_REASON, runAttentionCopy } from '@dltech/atlas-client/transcript'
import {
  ERunRemedy,
  providerLabelOf,
  remediesOf,
  type RunFailure,
  type V2Event,
} from '@dltech/atlas-core'
import type { RunAttentionAction } from '@dltech/atlas-ui/ai/run-attention-strip'

import { runAttentionActionsOf } from '@/features/threads/data/run-attention-actions'
import type { RunFailureCardProps } from '@/features/threads/transcript/run-failure-card'

type RunFailedEvent = Extract<V2Event, { type: 'run-failed' }>

const RUN_GATED: ReadonlySet<ERunRemedy> = new Set([ERunRemedy.Retry, ERunRemedy.Resume])

const isRunFailed = (event: V2Event): event is RunFailedEvent => event.type === 'run-failed'

const supersedesFailure = (event: V2Event): boolean =>
  event.type === 'user-said' || event.type === 'assistant-said'

const superseded = (args: { events: readonly V2Event[]; seq: number }): boolean =>
  args.events.some((event) => event.seq > args.seq && supersedesFailure(event))

export function sessionAttentionOf(args: {
  events: readonly V2Event[]
  working: boolean
}): RunAttention | null {
  const failed = args.events.filter(isRunFailed).at(-1)
  if (failed === undefined) return null
  if (superseded({ events: args.events, seq: failed.seq })) return null
  const failure: RunFailure = failed.failure
  const remedies = remediesOf(failure.kind).map((remedy) => ({
    remedy,
    enabled: !RUN_GATED.has(remedy) || !args.working,
  }))
  return {
    failure,
    message: failure.message,
    failureSeq: failed.seq,
    runId: failed.runId,
    remedies,
    dismissible: false,
    busyReason: remedies.some((entry) => !entry.enabled) ? BUSY_REASON : null,
  }
}

const metaOf = (args: {
  failure: RunFailure
  accountLabel: string | undefined
}): string | undefined => {
  const parts = [args.accountLabel, args.failure.modelId].filter(
    (part): part is string => part !== undefined && part !== '',
  )
  return parts.length === 0 ? undefined : parts.join(' · ')
}

const SWITCH_MODEL_LABEL = 'Switch model'

const withSwitchModel = (args: {
  actions: readonly RunAttentionAction[]
  switchModel: () => void
}): RunAttentionAction[] => {
  if (args.actions.some((action) => action.id === ERunRemedy.SwitchModel)) return [...args.actions]
  return [
    ...args.actions,
    {
      id: ERunRemedy.SwitchModel,
      label: SWITCH_MODEL_LABEL,
      primary: args.actions.length === 0,
      disabled: false,
      onSelect: args.switchModel,
    },
  ]
}

export function sessionFailureCardOf(args: {
  attention: RunAttention
  accountLabelOf: (accountId: string) => string | undefined
  handlers: {
    retry: () => void
    fixCredential: () => void
    switchModel: () => void
    openAgent: (agentId: string) => void
  }
}): RunFailureCardProps {
  const { attention, handlers } = args
  const failure = attention.failure
  const accountId = failure?.accountId
  const accountLabel = accountId === undefined ? undefined : args.accountLabelOf(accountId)
  const copy = runAttentionCopy({
    attention,
    providerLabel: providerLabelOf(failure?.providerId),
    accountLabel,
  })
  const actions = withSwitchModel({
    actions: runAttentionActionsOf({
      attention,
      agentId: failure?.agent?.agentId,
      handlers: { ...handlers, resume: handlers.retry, compact: () => undefined },
    }),
    switchModel: handlers.switchModel,
  })
  const meta = failure === null ? undefined : metaOf({ failure, accountLabel })
  return { ...copy, actions, ...(meta === undefined ? {} : { meta }) }
}
