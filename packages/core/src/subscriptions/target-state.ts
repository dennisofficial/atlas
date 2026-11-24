import type { EventBody } from '../events/body'
import type { JsonValue } from '../json/value'

export enum ETargetPhase {
  Open = 'open',
  Terminal = 'terminal',
  Unknown = 'unknown',
}

export type SubscriptionSnapshot = {
  facts: readonly string[]
  next: string
}

export type SubscriptionTargetState =
  | { phase: ETargetPhase.Open; summary: string; snapshot?: SubscriptionSnapshot | undefined }
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
  snapshot?: SubscriptionSnapshot | undefined
  ended: boolean
}

export const UNKNOWN_TARGET_STATE: SubscriptionTargetState = { phase: ETargetPhase.Unknown }

export const subscribedTargetOf = (
  state: SubscriptionTargetState,
): SubscribedTarget | undefined => {
  if (state.phase === ETargetPhase.Unknown) return undefined
  if (state.phase === ETargetPhase.Terminal) {
    return { phase: state.phase, summary: state.summary, ended: true }
  }
  return {
    phase: state.phase,
    summary: state.summary,
    ...(state.snapshot === undefined ? {} : { snapshot: state.snapshot }),
    ended: false,
  }
}

const snapshotLines = (snapshot: SubscriptionSnapshot | undefined): string =>
  snapshot === undefined
    ? ''
    : [...snapshot.facts.map((fact) => `\n${fact}`), `\n${snapshot.next}`].join('')

export const subscribedTargetText = (target: SubscribedTarget | undefined): string => {
  if (target === undefined || target.summary === undefined) return ''
  if (!target.ended) return ` ${target.summary}${snapshotLines(target.snapshot)}`
  return ` ${target.summary} Its final notice arrives now, and the subscription ended.`
}
