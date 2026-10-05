import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Event, ThreadId } from '@dltech/atlas-core'

import { dropTornTail, encodeEvent } from '../store/sessions/lines'
import { newThreadMeta, readMetaSync, threadMetaSchema, writeMeta } from '../store/sessions/meta'
import { eventLogFile, threadMetaFile } from '../store/sessions/paths'
import { registryFor, type SessionRegistry } from '../store/sessions/registry'

export type MirrorWriter = {
  appendDelta(args: { threadId: ThreadId; events: readonly Event[] }): Promise<void>
  rewriteFrom(args: { threadId: ThreadId; fromSeq: number; events: readonly Event[] }): Promise<void>
}

type MirrorTarget = { file: string; sessionDir: string; registry: SessionRegistry }

export function mirrorWriter(args: { home: () => string }): MirrorWriter {
  const exclusively = async <T>({ threadId, run }: { threadId: ThreadId; run: (target: MirrorTarget) => Promise<T> }): Promise<T> => {
    const registry = registryFor({ home: args.home() })
    const sessionDir = await registry.sessionDirFor({ threadId })
    const file = eventLogFile({ sessionDir, threadId })
    return registry.enqueue({ handle: registry.handleFor({ sessionDir }), run: () => run({ file, sessionDir, registry }) })
  }

  const setHead = async ({ threadId, sessionDir, head }: { threadId: ThreadId; sessionDir: string; head: number }): Promise<void> => {
    const metaFile = threadMetaFile({ sessionDir, threadId })
    const meta = readMetaSync({ file: metaFile, schema: threadMetaSchema }) ?? newThreadMeta({ id: threadId, at: new Date().toISOString() })
    if (meta.head === head) return
    await writeMeta({ file: metaFile, meta: { ...meta, head, updatedAt: new Date().toISOString() } })
  }

  const lineOf = (event: Event): string => `${encodeEvent({ event })}\n`

  const appendDelta = async (given: { threadId: ThreadId; events: readonly Event[] }): Promise<void> => {
    const first = given.events[0]
    if (first === undefined) return
    await exclusively({ threadId: given.threadId, run: async ({ file, sessionDir, registry }) => {
      const existing = await registry.readThreadLog({ sessionDir, threadId: given.threadId })
      if (first.seq <= existing.head) {
        throw new Error(`cannot mirror a delta starting at seq ${first.seq}: the local head is already ${existing.head}`)
      }
      await mkdir(dirname(file), { recursive: true })
      await dropTornTail({ file, threadId: given.threadId, on: 'append' })
      await appendFile(file, given.events.map(lineOf).join(''), 'utf8')
      await setHead({ threadId: given.threadId, sessionDir, head: given.events[given.events.length - 1]?.seq ?? existing.head })
      registry.invalidateSession({ sessionDir })
    } })
  }

  const rewriteFrom = async (given: { threadId: ThreadId; fromSeq: number; events: readonly Event[] }): Promise<void> => {
    await exclusively({ threadId: given.threadId, run: async ({ file, sessionDir, registry }) => {
      const existing = await registry.readThreadLog({ sessionDir, threadId: given.threadId })
      const kept = existing.events.filter((event) => event.seq < given.fromSeq)
      const staged = `${file}.${process.pid}.mirror.tmp`
      await mkdir(dirname(file), { recursive: true })
      await writeFile(staged, [...kept, ...given.events].map(lineOf).join(''))
      await rename(staged, file)
      const head = given.events.at(-1)?.seq ?? kept.at(-1)?.seq ?? 0
      await setHead({ threadId: given.threadId, sessionDir, head })
      registry.invalidateSession({ sessionDir })
    } })
  }

  return { appendDelta, rewriteFrom }
}
