import { createHash } from 'node:crypto'
import { appendFile, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  EVENT_LINE_VERSION,
  SESSION_FORMAT_VERSION,
  THREAD_META_VERSION,
  sessionDirectory,
  sessionMetaFile,
  threadMetaFile,
  transcriptIdentityDigest,
  type ThreadModel,
} from '@dltech/atlas-harness'
import type { Event, ThreadId } from '@dltech/atlas-core'

const ENVELOPE_KEYS = new Set(['id', 'seq', 'threadId', 'runId', 'parentRunId', 'depth', 'at'])

const encodeLine = (event: Event): string => {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (!ENVELOPE_KEYS.has(key) && value !== undefined) body[key] = value
  }
  const line = {
    v: EVENT_LINE_VERSION,
    id: event.id,
    seq: event.seq,
    threadId: event.threadId,
    runId: event.runId,
    ...(event.parentRunId === undefined ? {} : { parentRunId: event.parentRunId }),
    depth: event.depth,
    at: event.at,
    type: event.type,
    body,
  }
  return `${JSON.stringify(line)}\n`
}

type DiskThread = {
  head: number
  title: string | null
  workspace: string | null
  repo: string | null
  model: ThreadModel | undefined
  executionLocation: string | null
}

export class FakeSessionDisk {
  private readonly threads = new Map<ThreadId, DiskThread>()

  constructor(private readonly homeDir: string) {}

  home(): string {
    return this.homeDir
  }

  private dir(args: { threadId: ThreadId }): string {
    return sessionDirectory({ home: this.homeDir, sessionId: args.threadId })
  }

  private held(args: { threadId: ThreadId }): DiskThread {
    const existing = this.threads.get(args.threadId)
    if (existing !== undefined) return existing
    const fresh: DiskThread = {
      head: 0,
      title: null,
      workspace: null,
      repo: null,
      model: undefined,
      executionLocation: null,
    }
    this.threads.set(args.threadId, fresh)
    return fresh
  }

  async append(args: { threadId: ThreadId; events: readonly Event[] }): Promise<void> {
    if (args.events.length === 0) return
    const thread = this.held(args)
    await mkdir(join(this.dir(args), 'threads'), { recursive: true })
    await appendFile(this.eventLogPath(args), args.events.map(encodeLine).join(''))
    thread.head = Math.max(...args.events.map((event) => event.seq))
    await this.writeThreadMeta(args)
  }

  async replaceAll(args: { threadId: ThreadId; events: readonly Event[] }): Promise<void> {
    const thread = this.held(args)
    await mkdir(join(this.dir(args), 'threads'), { recursive: true })
    await writeFile(this.eventLogPath(args), args.events.map(encodeLine).join(''))
    thread.head = args.events.at(-1)?.seq ?? 0
    await this.writeThreadMeta(args)
  }

  private eventLogPath(args: { threadId: ThreadId }): string {
    return join(this.dir(args), 'threads', `${args.threadId}.events.jsonl`)
  }

  async writeThreadMeta(args: { threadId: ThreadId }): Promise<void> {
    const thread = this.held(args)
    const meta = {
      v: THREAD_META_VERSION,
      id: args.threadId,
      title: thread.title,
      head: thread.head,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      parentThreadId: null,
      forkSeq: null,
      forkMode: null,
      spawnerThreadId: null,
      agentType: null,
      workspace: thread.workspace,
      repo: thread.repo,
      modelRef: thread.model?.ref ?? null,
      modelEffort: thread.model?.effort ?? null,
      executionLocation: thread.executionLocation,
      placement: null,
    }
    const file = threadMetaFile({ sessionDir: this.dir(args), threadId: args.threadId })
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(meta)}\n`)
  }

  async writeSessionMeta(args: { threadId: ThreadId }): Promise<void> {
    const thread = this.held(args)
    const meta = {
      format: SESSION_FORMAT_VERSION,
      id: args.threadId,
      title: thread.title,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      home: 'host',
      repo: thread.repo,
      workspace: thread.workspace,
      worktree: null,
      pullRequests: null,
      spend: null,
    }
    const file = sessionMetaFile({ sessionDir: this.dir(args) })
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(meta)}\n`)
  }

  async stampProvenance(args: { threadId: ThreadId; archiveDigest: string | null }): Promise<void> {
    const dir = this.dir(args)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'transcript-origin.json'),
      `${JSON.stringify({ threadId: args.threadId, archiveDigest: args.archiveDigest, initialized: true })}\n`,
    )
  }

  async replaceSessionDir(args: { threadId: ThreadId; fromDir: string }): Promise<void> {
    const target = this.dir(args)
    await rm(target, { recursive: true, force: true })
    await mkdir(dirname(target), { recursive: true })
    await cp(args.fromDir, target, { recursive: true })
    this.threads.delete(args.threadId)
  }

  rename(args: { threadId: ThreadId; title: string }): void {
    this.held(args).title = args.title
  }

  chooseModel(args: { threadId: ThreadId; model: ThreadModel }): void {
    this.held(args).model = args.model
  }

  adopt(args: { threadId: ThreadId; workspace: string | null; repo: string | null }): void {
    const thread = this.held(args)
    thread.workspace = args.workspace
    thread.repo = args.repo
  }

  locate(args: { threadId: ThreadId; location: string }): void {
    this.held(args).executionLocation = args.location
  }
}

export const digestOfArchive = (archive: Uint8Array): string =>
  createHash('sha256').update(archive).digest('hex')

export const identityReplyOf = (events: readonly Event[]): { count: number; digest: string } => ({
  count: events.length,
  digest: transcriptIdentityDigest(events),
})
