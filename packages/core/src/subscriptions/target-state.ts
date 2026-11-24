import type { EventBody } from '../events/body'
import type { JsonValue } from '../json/value'

export enum ETargetPhase {
  Open = 'open',
  Terminal = 'terminal',
  Unknown = 'unknown',
}

export type SubscriptionTargetState =
  | { phase: ETargetPhase.Open; summary: string }
  | { phase: ETargetPhase.Terminal; summary: string; notice: EventBody }
  | { phase: ETargetPhase.Unknown }

export type SubscriptionTargetStates = {
  read(args: {
    userId: string
    provider: string
    target: JsonValue
  }): Promise<SubscriptionTargetState>
}

export type SubscribedTarget = {
  phase: ETargetPhase
  summary?: string | undefined
  ended: boolean
}

export const UNKNOWN_TARGET_STATE: SubscriptionTargetState = { phase: ETargetPhase.Unknown }

export const subscribedTargetOf = (
  state: SubscriptionTargetState,
): SubscribedTarget | undefined => {
  if (state.phase === ETargetPhase.Unknown) return undefined
  return {
    phase: state.phase,
    summary: state.summary,
    ended: state.phase === ETargetPhase.Terminal,
  }
}

export const subscribedTargetText = (target: SubscribedTarget | undefined): string => {
  if (target === undefined || target.summary === undefined) return ''
  if (!target.ended) return ` ${target.summary}`
  return ` ${target.summary} Its final notice arrives now, and the subscription ended.`
}
