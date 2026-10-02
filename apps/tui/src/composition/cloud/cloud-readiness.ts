import type { CloudChannel } from '@dltech/atlas-harness'
import type { ThreadIdentity } from '../thread-reads'

export type CloudAppliedSnapshot = {
  identity: ThreadIdentity
  appliedAt: number
}

export type CloudTranscriptReadiness = {
  registerApplied(identity: ThreadIdentity | null, appliedAt: number | null): void
  applied(): CloudAppliedSnapshot | null
  subscribe(listener: () => void): () => void
  waitUntilApplied(identity: ThreadIdentity): Promise<void>
  cancelWaiting(): void
}

const readinessByChannel = new WeakMap<Pick<CloudChannel, 'threadId'>, CloudTranscriptReadiness>()

const matchesIdentity = (args: {
  applied: ThreadIdentity | undefined
  wanted: ThreadIdentity
}): boolean => args.applied?.head === args.wanted.head &&
  args.applied.count === args.wanted.count && args.applied.digest === args.wanted.digest

export const cloudReadinessOf = (
  channel: Pick<CloudChannel, 'threadId'>,
): CloudTranscriptReadiness => {
  const held = readinessByChannel.get(channel)
  if (held !== undefined) return held

  let applied: CloudAppliedSnapshot | null = null
  const listeners = new Set<() => void>()
  const waiting = new Set<{ identity: ThreadIdentity; resolve: () => void; reject: (error: Error) => void }>()
  const created: CloudTranscriptReadiness = {
    registerApplied(identity, appliedAt) {
      applied = identity === null || appliedAt === null ? null : { identity, appliedAt }
      for (const waiter of waiting) {
        if (!matchesIdentity({ applied: applied?.identity, wanted: waiter.identity })) continue
        waiting.delete(waiter)
        waiter.resolve()
      }
      for (const listener of [...listeners]) listener()
    },
    applied: () => applied,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    waitUntilApplied(identity) {
      if (matchesIdentity({ applied: applied?.identity, wanted: identity })) return Promise.resolve()
      return new Promise((resolve, reject) => { waiting.add({ identity, resolve, reject }) })
    },
    cancelWaiting() {
      for (const waiter of waiting) waiter.reject(new Error('the cloud attachment was detached before its transcript was applied'))
      waiting.clear()
    },
  }
  readinessByChannel.set(channel, created)
  return created
}
