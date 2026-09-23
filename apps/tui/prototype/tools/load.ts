// PROTOTYPE — throwaway. Reads a real thread out of the Atlas sessions store so the tool-call
// variants are judged against real transcripts rather than invented fixtures.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { toThreadId, type Event } from '@dltech/atlas-core'
import {
  atlasDirectory,
  eventLogFile,
  parseEventLines,
  readSessionMetaSync,
  sessionMetaFile,
  sessionsDirectory,
} from '@dltech/atlas-harness'

export type ThreadRow = { id: string; title: string | null; events: number; tools: number }

const DEFAULT_HOME = sessionsDirectory({ home: atlasDirectory() })

const readText = (file: string): string => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export const databasePath = (argv: readonly string[]): string =>
  argv.find((arg) => arg.startsWith('--db='))?.slice('--db='.length) ??
  argv.find((arg) => arg.startsWith('--from='))?.slice('--from='.length) ??
  DEFAULT_HOME

export function threadsIn(path: string): ThreadRow[] {
  const rows: ThreadRow[] = []
  for (const dir of readdirSync(path)) {
    const sessionDir = join(path, dir)
    const meta = readSessionMetaSync({ file: sessionMetaFile({ sessionDir }), sessionDir })
    if (meta === undefined) continue
    const file = eventLogFile({ sessionDir, threadId: toThreadId(meta.id) })
    const parsed = parseEventLines({ text: readText(file), threadId: meta.id })
    rows.push({
      id: meta.id,
      title: meta.title,
      events: parsed.events.length,
      tools: parsed.events.filter((event) => event.type === 'tool-called').length,
    })
  }
  return rows.sort((a, b) => b.tools - a.tools || b.events - a.events)
}

export type LoadedThread = { thread: ThreadRow; events: readonly Event[]; unreadable: number }

export function loadThread(args: { path: string; threadId?: string | undefined }): LoadedThread {
  const threads = threadsIn(args.path)
  const thread =
    args.threadId === undefined
      ? threads[0]
      : threads.find((candidate) => candidate.id === args.threadId)

  if (thread === undefined) throw new Error(`no thread to render in ${args.path}`)

  const sessionDir = join(args.path, thread.id)
  const file = eventLogFile({ sessionDir, threadId: toThreadId(thread.id) })
  const parsed = parseEventLines({ text: readFileSync(file, 'utf8'), threadId: thread.id })
  return { thread, events: parsed.events, unreadable: parsed.unreadable.length }
}
