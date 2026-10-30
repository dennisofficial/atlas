import {
  EAgentStatus,
  ERunFailureKind,
  ERunRemedy,
  isResumable,
  remediesOf,
  runFailureCopy,
  type Event,
  type RunFailure,
  type RunId,
} from '@dltech/atlas-core'

import type { InFlightStep } from './in-flight-steps'
import { failureKindOf, pickFailure } from './pick-failure'
import { latestRunFailure, legacyFailureOf } from './run-failure'

export type RunAttentionRemedy = { remedy: ERunRemedy; enabled: boolean }

export type RunAttention = {
  failure: RunFailure | null
  message: string
  failureSeq: number | null
  runId: RunId | null
  remedies: RunAttentionRemedy[]
  dismissible: boolean
  busyReason: string | null
}

export type FailedAgent = {
  agentId: string
  agentType: string
  intent: string
  failureKind: ERunFailureKind
  failureCause: string | undefined
}

export const BUSY_REASON = 'Retry is unavailable while a run is in flight.'
export const INTERRUPTED_TITLE = 'The run stopped before finishing'
export const INTERRUPTED_DETAIL = 'Resume continues from the last finished step; nothing is rerun.'

const RUN_GATED: ReadonlySet<ERunRemedy> = new Set([ERunRemedy.Retry, ERunRemedy.Resume])

function remediesFor(args: { kind: ERunFailureKind; idleAndReady: boolean }): RunAttentionRemedy[] {
  return remediesOf(args.kind).map((remedy) => ({
    remedy,
    enabled: !RUN_GATED.has(remedy) || args.idleAndReady,
  }))
}

const busyReasonOf = (remedies: readonly RunAttentionRemedy[]): string | null =>
  remedies.some((entry) => !entry.enabled) ? BUSY_REASON : null

export function runAttentionOf(args: {
  events: readonly Event[]
  live: readonly InFlightStep[]
  working: boolean
  turnInFlight: boolean
  channelReady: boolean
  settling?: boolean | undefined
}): RunAttention | null {
  const idleAndReady =
    !args.working && !args.turnInFlight && args.channelReady && args.settling !== true

  const picked = pickFailure({
    steps: args.live,
    durable: latestRunFailure(args.events),
    legacy: legacyFailureOf(args.events),
    streaming: args.working,
  })

  if (picked !== null) {
    const remedies = remediesFor({ kind: failureKindOf(picked), idleAndReady })
    return {
      ...picked,
      message: picked.message ?? '',
      remedies,
      dismissible: picked.failureSeq !== null,
      busyReason: busyReasonOf(remedies),
    }
  }

  if (!idleAndReady || !isResumable(args.events)) return null
  return {
    failure: null,
    message: INTERRUPTED_TITLE,
    failureSeq: null,
    runId: null,
    remedies: [{ remedy: ERunRemedy.Resume, enabled: true }],
    dismissible: false,
    busyReason: null,
  }
}

export function failedAgentsOf(events: readonly Event[]): FailedAgent[] {
  const lastUser = events.findLastIndex((event) => event.type === 'user-said')
  return events.slice(lastUser + 1).flatMap((event) =>
    event.type === 'agent-ended' &&
    event.status === EAgentStatus.Failed &&
    event.failureKind !== undefined
      ? [
          {
            agentId: event.agentId,
            agentType: event.agentType,
            intent: event.intent,
            failureKind: event.failureKind,
            failureCause: event.failureCause,
          },
        ]
      : [],
  )
}

export function runAttentionCopy(args: {
  attention: RunAttention
  providerLabel?: string | undefined
  accountLabel?: string | undefined
}): { title: string; detail: string } {
  const { attention } = args
  if (attention.failure !== null) {
    const { title, detail } = runFailureCopy({
      failure: attention.failure,
      providerLabel: args.providerLabel,
      accountLabel: args.accountLabel,
    })
    return { title, detail }
  }
  if (attention.remedies.some((entry) => entry.remedy === ERunRemedy.Resume)) {
    return { title: INTERRUPTED_TITLE, detail: INTERRUPTED_DETAIL }
  }
  return { title: 'The run failed', detail: attention.message }
}
