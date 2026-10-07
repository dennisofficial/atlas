import type { ECompactionAnchor, EForkMode, ClockPort, EventLogPort, IdPort, ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../thread-store'
import type { SessionRegistry } from './registry'

export type ThreadStoreContext = {
  home: string
  registry: SessionRegistry
  clock: ClockPort
  ids: IdPort
  log: EventLogPort
}

export type CreateArgs = Parameters<ThreadStorePort['create']>[0]

export type MarkArgs = { threadId: ThreadId; anchor: ECompactionAnchor; fromSeq: number; throughSeq: number; summary: string }

export type RewindArgs = { threadId: ThreadId; toSeq: number; cutAgents?: readonly ThreadId[] | undefined }

export type ForkArgs = { from: ThreadId; seq: number; mode: EForkMode; title?: string | undefined }
