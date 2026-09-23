import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { Event, ThreadId } from '@dltech/atlas-core'

import type { ContextIdentity } from '../append-plan'
import { contextIdentityOf } from '../append-plan'
import type { UnreadableRow } from '../decode-events'
import { parseEventLines } from './lines'
import { THREAD_META_FILE_SUFFIX, eventLogFile, sessionDirectory, sessionsDirectory, threadMetaFile, threadsDirectory } from './paths'
import { readMetaSync, threadMetaSchema } from './meta'

export type ThreadLog = {
  events: Event[]
  unreadable: UnreadableRow[]
  head: number
  byContext: Map<ContextIdentity, Event>
}

export function emptyThreadLog(): ThreadLog {
  return { events: [], unreadable: [], head: 0, byContext: new Map() }
}

export function rebuildContextIndex({ log }: { log: ThreadLog }): void {
  log.byContext.clear()
  for (const event of log.events) {
    const identity = contextIdentityOf(event)
    if (identity !== undefined) log.byContext.set(identity, event)
  }
}

type SessionHandle = {
  dir: string
  threads: Map<string, ThreadLog>
  queue: Promise<unknown>
}

type ParentCacheEntry = { events: Event[]; byteLength: number }

export class SessionRegistry {
  private readonly handles = new Map<string, SessionHandle>()
  private readonly threadIndex = new Map<string, string>()
  private threadIndexBuilt = false
  private readonly parentCache = new Map<string, ParentCacheEntry>()

  constructor(private readonly home: string) {}

  handleFor({ sessionDir }: { sessionDir: string }): SessionHandle {
    const existing = this.handles.get(sessionDir)
    if (existing !== undefined) return existing
    const handle: SessionHandle = { dir: sessionDir, threads: new Map(), queue: Promise.resolve() }
    this.handles.set(sessionDir, handle)
    return handle
  }

  enqueue<T>({ handle, run }: { handle: SessionHandle; run: () => Promise<T> }): Promise<T> {
    const next = handle.queue.then(run)
    handle.queue = next.catch(() => {})
    return next
  }

  registerThread({ sessionDir, threadId }: { sessionDir: string; threadId: ThreadId }): void {
    this.threadIndex.set(threadId, sessionDir)
  }

  forgetThread({ sessionDir, threadId }: { sessionDir: string; threadId: ThreadId }): void {
    this.threadIndex.delete(threadId)
    this.handles.get(sessionDir)?.threads.delete(threadId)
  }

  async sessionDirOf({ threadId }: { threadId: ThreadId }): Promise<string | undefined> {
    const known = this.threadIndex.get(threadId)
    if (known !== undefined) return known

    if (!this.threadIndexBuilt) {
      this.threadIndexBuilt = true
      await this.scanThreadIndex()
      const found = this.threadIndex.get(threadId)
      if (found !== undefined) return found
    }
    return undefined
  }

  async sessionDirFor({ threadId }: { threadId: ThreadId }): Promise<string> {
    const resolved = await this.sessionDirOf({ threadId })
    if (resolved !== undefined) return resolved
    return sessionDirectory({ home: this.home, sessionId: threadId })
  }

  async readThreadLog({
    sessionDir,
    threadId,
  }: {
    sessionDir: string
    threadId: ThreadId
  }): Promise<ThreadLog> {
    const handle = this.handleFor({ sessionDir })
    const cached = handle.threads.get(threadId)
    if (cached !== undefined) return cached

    const file = eventLogFile({ sessionDir, threadId })
    const text = await readFile(file, 'utf8').catch(() => '')
    const parsed = parseEventLines({ text, threadId })
    const meta = readMetaSync({
      file: threadMetaFile({ sessionDir, threadId }),
      schema: threadMetaSchema,
    })
    const log: ThreadLog = {
      events: parsed.events,
      unreadable: parsed.unreadable,
      head: Math.max(parsed.head, meta?.head ?? 0),
      byContext: new Map(),
    }
    rebuildContextIndex({ log })
    handle.threads.set(threadId, log)
    this.registerThread({ sessionDir, threadId })
    return log
  }

  async readParentEvents({ file }: { file: string }): Promise<Event[]> {
    const size = (await stat(file).catch(() => undefined))?.size ?? 0
    const cached = this.parentCache.get(file)
    if (cached !== undefined && cached.byteLength === size) return cached.events

    const text = await readFile(file, 'utf8').catch(() => '')
    const threadId = threadIdFromFile({ file })
    const parsed = parseEventLines({ text, threadId })
    this.parentCache.set(file, { events: parsed.events, byteLength: size })
    return parsed.events
  }

  invalidateParent({ file }: { file: string }): void {
    this.parentCache.delete(file)
  }

  private async scanThreadIndex(): Promise<void> {
    const root = sessionsDirectory({ home: this.home })
    const sessions = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const sessionDir = join(root, session.name)
      const metas = await readdir(threadsDirectory({ sessionDir })).catch(() => [] as string[])
      for (const file of metas) {
        if (!file.endsWith(THREAD_META_FILE_SUFFIX)) continue
        const meta = readMetaSync({
          file: join(threadsDirectory({ sessionDir }), file),
          schema: threadMetaSchema,
        })
        if (meta !== undefined) this.threadIndex.set(meta.id, sessionDir)
      }
    }
  }
}

function threadIdFromFile({ file }: { file: string }): ThreadId {
  const base = file.split('/').pop() ?? ''
  return base.replace(/\.events\.jsonl$/, '') as ThreadId
}

const registries = new Map<string, SessionRegistry>()

export function registryFor({ home }: { home: string }): SessionRegistry {
  const existing = registries.get(home)
  if (existing !== undefined) return existing
  const registry = new SessionRegistry(home)
  registries.set(home, registry)
  return registry
}
