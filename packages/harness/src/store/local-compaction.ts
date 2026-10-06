import type { ECompactionAnchor, EventLogPort, ThreadId } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import {
  compactTurn,
  summariseAt,
  type Compaction,
  type ECompactScope,
  type Summariser,
} from '../composition/compact-turn'
import { CompactionPort } from './compaction-port'
import type { ThreadStorePort } from './thread-store'

export class LocalCompaction extends CompactionPort {
  private readonly log: EventLogPort
  private readonly threads: ThreadStorePort
  private readonly agents: AgentRegistryPort
  private readonly summariser: Summariser

  constructor(args: {
    log: EventLogPort
    threads: ThreadStorePort
    agents: AgentRegistryPort
    summarise: Summariser
  }) {
    super()
    this.log = args.log
    this.threads = args.threads
    this.agents = args.agents
    this.summariser = args.summarise
  }

  compact(args: {
    threadId: ThreadId
    scope?: ECompactScope | undefined
    signal?: AbortSignal | undefined
  }): Promise<Compaction> {
    return compactTurn({
      log: this.log,
      threads: this.threads,
      agents: this.agents,
      threadId: args.threadId,
      summarise: this.summariser,
      ...(args.scope === undefined ? {} : { scope: args.scope }),
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
  }

  summarise(args: {
    threadId: ThreadId
    anchor: ECompactionAnchor
    seq: number
    signal?: AbortSignal | undefined
  }): Promise<Compaction> {
    return summariseAt({
      log: this.log,
      threads: this.threads,
      agents: this.agents,
      threadId: args.threadId,
      anchor: args.anchor,
      seq: args.seq,
      summarise: this.summariser,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
  }
}
