import type { ThreadId } from '@dltech/atlas-core'
import {
  JsonlEventLog,
  JsonlThreadStore,
  RandomIds,
  SystemClock,
  registryFor,
} from '@dltech/atlas-harness'

import { familyThreadIdsOf } from './workspace-hooks'

type ThreadFamily = Pick<JsonlThreadStore, 'spawned'>

const opened = new Map<string, ThreadFamily>()

const familyStoreOf = (atlasHome: string): ThreadFamily => {
  const cached = opened.get(atlasHome)
  if (cached !== undefined) return cached
  const registry = registryFor({ home: atlasHome })
  const clock = new SystemClock()
  const ids = new RandomIds()
  const log = new JsonlEventLog(atlasHome, registry, clock, ids)
  const store = new JsonlThreadStore(atlasHome, registry, clock, ids, log)
  opened.set(atlasHome, store)
  return store
}

/**
 * Whether the named thread is the served root or one of its spawned descendants, read from the
 * persisted thread store so an answer exists before the composed app does.
 */
export function admitsFamilyThread(args: {
  root: ThreadId
  atlasHome: string
}): (threadId: string) => Promise<boolean> {
  const threads = familyStoreOf(args.atlasHome)
  return async (threadId) => {
    if (threadId === args.root) return true
    try {
      return (await familyThreadIdsOf({ root: args.root, threads })).has(threadId as ThreadId)
    } catch {
      return false
    }
  }
}
