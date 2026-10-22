import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import {
  readMetaSync,
  SessionAuthorityPort,
  sessionMetaSchema,
  type MainThreadFence,
  type SessionMeta,
} from './meta'
import { sessionMetaFile } from './paths'
import type { SessionRegistry } from './registry'

export class JsonlSessionAuthority extends SessionAuthorityPort {
  constructor(private readonly deps: { registry: SessionRegistry }) {
    super()
  }

  private get registry(): SessionRegistry {
    return this.deps.registry
  }

  async activeMainOf(args: { sessionId: string }): Promise<ThreadId | undefined> {
    const meta = await this.read({ sessionId: args.sessionId })
    return meta === undefined ? undefined : toThreadId(meta.activeMainThreadId ?? meta.id)
  }

  async mainGenerationOf(args: { threadId: ThreadId }): Promise<number | undefined> {
    const meta = await this.read({ sessionId: args.threadId })
    if (meta === undefined) return undefined
    if (meta.activeMainThreadId === undefined || meta.activeMainThreadId === null) {
      return args.threadId === meta.id ? 1 : undefined
    }
    if (args.threadId === meta.activeMainThreadId) return 1
    return undefined
  }

  async fenceMainThread(args: {
    threadId: ThreadId
    generation?: number | undefined
  }): Promise<MainThreadFence> {
    const meta = await this.read({ sessionId: args.threadId })
    if (meta === undefined) return { allowed: false, activeMain: null }
    const activeMain = toThreadId(meta.activeMainThreadId ?? meta.id)
    if (args.threadId !== activeMain) return { allowed: false, activeMain }
    const generation = await this.mainGenerationOf(args)
    if (generation === undefined) return { allowed: false, activeMain }
    if (
      args.generation !== undefined &&
      args.generation !== null &&
      args.generation !== generation
    ) {
      return { allowed: false, activeMain }
    }
    return { allowed: true, generation }
  }

  private async read({ sessionId }: { sessionId: string }): Promise<SessionMeta | undefined> {
    const sessionDir = await this.registry.sessionDirFor({ threadId: sessionId as ThreadId })
    return readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
  }
}
