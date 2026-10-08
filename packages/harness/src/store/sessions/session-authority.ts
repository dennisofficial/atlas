import { toThreadId, type ClockPort, type ThreadId } from '@dltech/atlas-core'

import {
  ERotationStatus,
  readMetaSync,
  SessionAuthorityPort,
  sessionMetaSchema,
  writeMeta,
  type MainThreadFence,
  type RotationWriteArgs,
  type SessionMeta,
} from './meta'
import { sessionMetaFile } from './paths'
import type { SessionRegistry } from './registry'

export class MainConflict extends Error {
  constructor(args: { sessionDir: string; expected: ThreadId; found: ThreadId }) {
    super(
      `session ${args.sessionDir} committed its active main elsewhere (expected ${args.expected}, found ${args.found}); the concurrent writer wins`,
    )
    this.name = 'MainConflict'
  }
}

export type RotationWrite = RotationWriteArgs

export class JsonlSessionAuthority extends SessionAuthorityPort {
  constructor(private readonly deps: { registry: SessionRegistry; clock: ClockPort }) {
    super()
  }

  private get registry(): SessionRegistry {
    return this.deps.registry
  }

  private get clock(): ClockPort {
    return this.deps.clock
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
    if (args.threadId === meta.rotation?.predecessor) return 0
    return undefined
  }

  async fenceMainThread(args: { threadId: ThreadId; generation?: number | undefined }): Promise<MainThreadFence> {
    const meta = await this.read({ sessionId: args.threadId })
    if (meta === undefined) return { allowed: false, activeMain: null }
    const activeMain = toThreadId(meta.activeMainThreadId ?? meta.id)
    if (args.threadId !== activeMain) return { allowed: false, activeMain }
    const generation = await this.mainGenerationOf(args)
    if (generation === undefined) return { allowed: false, activeMain }
    if (args.generation !== undefined && args.generation !== null && args.generation !== generation) {
      return { allowed: false, activeMain }
    }
    return { allowed: true, generation }
  }

  async writeRotation(args: { sessionId: string; write: RotationWrite }): Promise<void> {
    const sessionDir = await this.registry.sessionDirFor({ threadId: args.sessionId as ThreadId })
    const file = sessionMetaFile({ sessionDir })
    const handle = this.registry.handleFor({ sessionDir })
    await this.registry.enqueue({
      handle,
      run: async () => {
        const existing = readMetaSync({ file, schema: sessionMetaSchema })
        if (existing === undefined) throw new Error(`cannot write rotation: ${sessionDir} has no session meta`)
        const held = toThreadId(existing.activeMainThreadId ?? existing.id)
        if (held !== args.write.expectedActiveMain) {
          throw new MainConflict({ sessionDir, expected: args.write.expectedActiveMain, found: held })
        }
        const next: SessionMeta = {
          ...existing,
          rotation: args.write.rotation,
          ...(args.write.nextActiveMain === undefined ? {} : { activeMainThreadId: args.write.nextActiveMain }),
          updatedAt: this.clock.now(),
        }
        await writeMeta({ file, meta: next })
      },
    })
  }

  async recoverInterruptedRotation(args: { sessionId: string }): Promise<void> {
    const meta = await this.read({ sessionId: args.sessionId })
    if (meta?.rotation?.status !== ERotationStatus.Preparing) return
    await this.writeRotation({
      sessionId: args.sessionId,
      write: {
        rotation: { ...meta.rotation, status: ERotationStatus.Aborted, updatedAt: this.clock.now() },
        expectedActiveMain: toThreadId(meta.activeMainThreadId ?? meta.id),
      },
    })
  }

  private async read({ sessionId }: { sessionId: string }): Promise<SessionMeta | undefined> {
    const sessionDir = await this.registry.sessionDirFor({ threadId: sessionId as ThreadId })
    return readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
  }
}
