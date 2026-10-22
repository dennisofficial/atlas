import { useSyncExternalStore } from 'react'

import {
  ESandboxProvisionState,
  type EVercelCredentialGap,
  type SandboxProvisionReply,
} from '@dltech/atlas-wire/web'

export const NOT_CONFIGURED_FALLBACK = 'Atlas Cloud could not start a sandbox for this thread.'

export type NotConfigured = { error: string; gap?: EVercelCredentialGap }

export function notConfiguredOf(reply: SandboxProvisionReply): NotConfigured | null {
  if (reply.state !== ESandboxProvisionState.NotConfigured) return null
  return {
    error: reply.error ?? NOT_CONFIGURED_FALLBACK,
    ...(reply.gap === undefined ? {} : { gap: reply.gap }),
  }
}

const outcomes = new Map<string, NotConfigured>()
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

export function setProvisionOutcome(args: { threadId: string; outcome: NotConfigured }): void {
  outcomes.set(args.threadId, args.outcome)
  emit()
}

export function clearProvisionOutcome(threadId: string): void {
  if (outcomes.delete(threadId)) emit()
}

export const provisionOutcomeOf = (threadId: string): NotConfigured | undefined =>
  outcomes.get(threadId)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useProvisionOutcome(threadId: string): NotConfigured | undefined {
  return useSyncExternalStore(
    subscribe,
    () => provisionOutcomeOf(threadId),
    () => undefined,
  )
}
