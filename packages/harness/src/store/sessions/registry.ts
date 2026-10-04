import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { Event, LogPort, ThreadId } from '@dltech/atlas-core'

import type { ContextIdentity } from '../append-plan'
import { contextIdentityOf } from '../append-plan'
import type { UnreadableRow } from '../decode-events'
import { logFieldsOf } from '../logs'
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
  files: Map<string, FileSignature>
  queue: Promise<unknown>
  generation: number
}

type FileSignature = { byteLength: number; modifiedAt: number }

type ParentCacheEntry = { events: Event[]; byteLength: number }

export class SessionRegistry {
  private readonly handles = new Map<string, SessionHandle>()
  private readonly threadIndex = new Map<string, string>()
  private threadIndexBuilt = false
  private readonly missedAfterBuild = new Set<string>()
  private readonly parentCache = new Map<string, ParentCacheEntry>()
  private parentGeneration = 0

  constructor(
    readonly home: string,
    private readonly logPort?: LogPort | undefined,
  ) {}

  handleFor({ sessionDir }: { sessionDir: string }): SessionHandle {
    const existing = this.handles.get(sessionDir)
    if (existing !== undefined) return existing
    const handle: SessionHandle = { dir: sessionDir, threads: new Map(), files: new Map(), queue: Promise.resolve(), generation: 0 }
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
    const handle = this.handles.get(sessionDir)
    handle?.threads.delete(threadId)
    handle?.files.delete(threadId)
  }

  async sessionDirOf({ threadId }: { threadId: ThreadId }): Promise<string | undefined> {
    const known = this.threadIndex.get(threadId)
    if (known !== undefined) return known

    if (!this.threadIndexBuilt) {
      this.threadIndexBuilt = true
      await this.scanThreadIndex()
      const found = this.threadIndex.get(threadId)
      if (found !== undefined) return found
      return undefined
    }

    // A transcript transfer can drop a thread's meta after the index was already built — a lifted
    // teammate lands in its parent's session dir while this process holds a completed scan. Rescan
    // once on a miss so the thread is found rather than reported absent to the resume path. A
    // thread that has already missed once since the last invalidation is genuinely absent (a
    // rewind-cut child, a mistyped id), so it does not rescan on every lookup.
    if (this.missedAfterBuild.has(threadId)) return undefined
    this.missedAfterBuild.add(threadId)
    await this.scanThreadIndex()
    return this.threadIndex.get(threadId)
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

    const generation = handle.generation
    const file = eventLogFile({ sessionDir, threadId })
    const text = await this.readEventLog({ file, threadId })
    const parsed = parseEventLines({ text, threadId, logPort: this.logPort })
    const meta = readMetaSync({
      file: threadMetaFile({ sessionDir, threadId }),
      schema: threadMetaSchema,
      logPort: this.logPort,
    })
    const log: ThreadLog = {
      events: parsed.events,
      unreadable: parsed.unreadable,
      head: Math.max(parsed.head, meta?.head ?? 0),
      byContext: new Map(),
    }
    const signature = await signatureOf({ file })
    if (handle.generation !== generation) return this.readThreadLog({ sessionDir, threadId })
    const current = handle.threads.get(threadId)
    if (current !== undefined) return current
    rebuildContextIndex({ log })
    handle.threads.set(threadId, log)
    handle.files.set(threadId, signature)
    this.registerThread({ sessionDir, threadId })
    return log
  }

  invalidateSession({ sessionDir }: { sessionDir: string }): void {
    const handle = this.handles.get(sessionDir)
    if (handle !== undefined) handle.generation += 1
    this.parentGeneration += 1
    handle?.threads.clear()
    handle?.files.clear()
    for (const [threadId, directory] of this.threadIndex) {
      if (directory === sessionDir) this.threadIndex.delete(threadId)
    }
    for (const file of this.parentCache.keys()) {
      if (file.startsWith(`${sessionDir}/`)) this.parentCache.delete(file)
    }
    this.threadIndexBuilt = false
    this.missedAfterBuild.clear()
  }

  async refreshThreadLog({
    sessionDir,
    threadId,
  }: {
    sessionDir: string
    threadId: ThreadId
  }): Promise<ThreadLog> {
    const handle = this.handleFor({ sessionDir })
    const signature = await signatureOf({ file: eventLogFile({ sessionDir, threadId }) })
    const known = handle.files.get(threadId)
    const cached = handle.threads.get(threadId)
    const current =
      known !== undefined &&
      known.byteLength === signature.byteLength &&
      known.modifiedAt === signature.modifiedAt
    if (cached !== undefined && current) return cached

    handle.threads.delete(threadId)
    handle.files.set(threadId, signature)
    return this.readThreadLog({ sessionDir, threadId })
  }

  async stampThreadLog({
    sessionDir,
    threadId,
  }: {
    sessionDir: string
    threadId: ThreadId
  }): Promise<void> {
    const handle = this.handleFor({ sessionDir })
    handle.files.set(threadId, await signatureOf({ file: eventLogFile({ sessionDir, threadId }) }))
  }

  async readParentEvents({ file }: { file: string }): Promise<Event[]> {
    const generation = this.parentGeneration
    const size = (await stat(file).catch(() => undefined))?.size ?? 0
    const cached = this.parentCache.get(file)
    if (cached !== undefined && cached.byteLength === size) return cached.events

    const threadId = threadIdFromFile({ file })
    const text = await this.readEventLog({ file, threadId })
    const parsed = parseEventLines({ text, threadId, logPort: this.logPort })
    if (generation !== this.parentGeneration) return this.readParentEvents({ file })
    this.parentCache.set(file, { events: parsed.events, byteLength: size })
    return parsed.events
  }

  invalidateParent({ file }: { file: string }): void {
    this.parentGeneration += 1
    this.parentCache.delete(file)
  }

  private async scanThreadIndex(): Promise<void> {
    const root = sessionsDirectory({ home: this.home })
    const sessions = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const session of sessions) {
      if (!session.isDirectory() || session.name.startsWith('.')) continue
      const sessionDir = join(root, session.name)
      const metas = await readdir(threadsDirectory({ sessionDir })).catch(() => [] as string[])
      for (const file of metas) {
        if (!file.endsWith(THREAD_META_FILE_SUFFIX)) continue
        const meta = readMetaSync({
          file: join(threadsDirectory({ sessionDir }), file),
          schema: threadMetaSchema,
          logPort: this.logPort,
        })
        if (meta !== undefined) this.threadIndex.set(meta.id, sessionDir)
      }
    }
  }

  private async readEventLog({ file, threadId }: { file: string; threadId: ThreadId }): Promise<string> {
    try {
      return await readFile(file, 'utf8')
    } catch (error) {
      const code = errorCodeOf({ error })
      if (code !== 'ENOENT') {
        this.logPort?.warn({
          source: 'store.registry',
          message: 'could not read an event log file, treating it as empty',
          threadId,
          data: { file, threadId, ...(code === undefined ? {} : { code }) },
          ...logFieldsOf({ error }),
        })
      }
      return ''
    }
  }
}

async function signatureOf({ file }: { file: string }): Promise<FileSignature> {
  const stats = await stat(file).catch(() => undefined)
  return { byteLength: stats?.size ?? 0, modifiedAt: stats?.mtimeMs ?? 0 }
}

function threadIdFromFile({ file }: { file: string }): ThreadId {
  const base = file.split('/').pop() ?? ''
  return base.replace(/\.events\.jsonl$/, '') as ThreadId
}

function errorCodeOf({ error }: { error: unknown }): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

const registries = new Map<string, SessionRegistry>()

export function registryFor({ home }: { home: string }): SessionRegistry {
  const existing = registries.get(home)
  if (existing !== undefined) return existing
  const registry = new SessionRegistry(home)
  registries.set(home, registry)
  return registry
}
