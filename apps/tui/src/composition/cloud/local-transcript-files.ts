import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Event, ThreadId } from '@dltech/atlas-core'
import {
  eventLogFile,
  EVENT_LINE_VERSION,
  readMetaSync,
  registryFor,
  threadMetaFile,
  threadMetaSchema,
  writeMeta,
} from '@dltech/atlas-harness'

export type TranscriptSwap = { revert(): Promise<void>; seal(): Promise<void> }

export type TranscriptFiles = {
  swap(args: { threadId: ThreadId; events: readonly Event[] }): Promise<TranscriptSwap>
}

const lineOf = (event: Event): string => {
  const { id, seq, threadId, runId, parentRunId, depth, at, ...body } = event
  return `${JSON.stringify({
    v: EVENT_LINE_VERSION,
    id,
    seq,
    threadId,
    runId,
    ...(parentRunId === undefined ? {} : { parentRunId }),
    depth,
    at,
    type: event.type,
    body,
  })}\n`
}

const textOf = async (file: string): Promise<string | undefined> =>
  readFile(file, 'utf8').catch(() => undefined)

/**
 * The canonical `<threadId>.events.jsonl`, rewritten with events exactly as the sandbox stamped
 * them. The log port cannot do this: its append restamps ids and seqs, and the transcript identity
 * a park checkpoint vouches for is a digest over those very ids and seqs.
 */
export function localTranscriptFiles(args: { home: () => string }): TranscriptFiles {
  const exclusively = async <T>(threadId: ThreadId, run: (file: string, sessionDir: string) => Promise<T>): Promise<T> => {
    const registry = registryFor({ home: args.home() })
    const sessionDir = await registry.sessionDirFor({ threadId })
    const file = eventLogFile({ sessionDir, threadId })
    return registry.enqueue({ handle: registry.handleFor({ sessionDir }), run: () => run(file, sessionDir) })
  }

  const raiseHead = async (given: { threadId: ThreadId; sessionDir: string; head: number }): Promise<void> => {
    const metaFile = threadMetaFile({ sessionDir: given.sessionDir, threadId: given.threadId })
    const meta = readMetaSync({ file: metaFile, schema: threadMetaSchema })
    if (meta === undefined || meta.head >= given.head) return
    await writeMeta({ file: metaFile, meta: { ...meta, head: given.head } })
  }

  const place = async (file: string, text: string | undefined): Promise<void> => {
    if (text === undefined) {
      await rm(file, { force: true })
      return
    }
    await mkdir(dirname(file), { recursive: true })
    const staged = `${file}.${process.pid}.parked.tmp`
    await writeFile(staged, text)
    await rename(staged, file)
  }

  return {
    swap: ({ threadId, events }) =>
      exclusively(threadId, async (file) => {
        const before = await textOf(file)
        await place(file, events.map(lineOf).join(''))
        return {
          revert: () => exclusively(threadId, (given) => place(given, before)),
          seal: () =>
            exclusively(threadId, (_file, sessionDir) =>
              raiseHead({ threadId, sessionDir, head: events.at(-1)?.seq ?? 0 }),
            ),
        }
      }),
  }
}
