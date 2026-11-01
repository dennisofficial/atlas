import { readFile } from 'node:fs/promises'
import { z } from 'zod'

import {
  nextReadSeq,
  type EventLogPort,
  type ThreadId,
  ThreadReadCursorPort,
} from '@dltech/atlas-core'

import { writeMeta } from './meta'
import { threadReadCursorFile } from './paths'
import type { SessionRegistry } from './registry'

const readCursorSchema = z.object({ seq: z.number().int().nonnegative() })

export class FileThreadReadCursor extends ThreadReadCursorPort {
  private readonly registry: SessionRegistry
  private readonly log: EventLogPort

  constructor(args: { registry: SessionRegistry; log: EventLogPort }) {
    super()
    this.registry = args.registry
    this.log = args.log
  }

  async readSeq({ threadId }: { threadId: ThreadId }): Promise<number | undefined> {
    const file = await this.fileOf({ threadId })
    const raw = await readFile(file, 'utf8').catch(() => undefined)
    if (raw === undefined) return undefined
    try {
      return readCursorSchema.parse(JSON.parse(raw)).seq
    } catch {
      return undefined
    }
  }

  async readKnownSeq({ threadId }: { threadId: ThreadId }): Promise<number | undefined> {
    const file = await this.fileOf({ threadId })
    try {
      const raw = await readFile(file, 'utf8')
      return readCursorSchema.parse(JSON.parse(raw)).seq
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
  }

  private queue: Promise<unknown> = Promise.resolve()

  markRead(args: { threadId: ThreadId; seq: number }): Promise<number> {
    const next = this.queue.then(() => this.markReadNow(args))
    this.queue = next.catch(() => undefined)
    return next
  }

  private async markReadNow({
    threadId,
    seq,
  }: {
    threadId: ThreadId
    seq: number
  }): Promise<number> {
    const existing = await this.readSeq({ threadId })
    const head = await this.log.head({ threadId })
    const next = nextReadSeq({ existing, seq, head })
    await writeMeta({ file: await this.fileOf({ threadId }), meta: { seq: next } })
    return next
  }

  private async fileOf({ threadId }: { threadId: ThreadId }): Promise<string> {
    const sessionDir = await this.registry.sessionDirFor({ threadId })
    return threadReadCursorFile({ sessionDir, threadId })
  }
}
