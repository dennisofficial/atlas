import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  EForkMode,
  stampDrafts,
  type ClockPort,
  type Event,
  type EventDraft,
  type EventEnvelope,
  type EventLogPort,
  type IdPort,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import { contextIdentityOf, planAppend, type ContextIdentity } from '../append-plan'
import type { UnreadableRow } from '../decode-events'
import { planSegments } from './compose'
import { encodeEventLine } from './lines'
import { newThreadMeta, readMetaSync, threadMetaSchema, writeMeta } from './meta'
import { eventLogFile, sessionDirectory, threadMetaFile, threadsDirectory } from './paths'
import { rebuildContextIndex, type SessionRegistry } from './registry'

export type DecodedSessionLog = {
  events: Event[]
  unreadable: UnreadableRow[]
}

export class JsonlEventLog implements EventLogPort {
  constructor(
    private readonly home: string,
    private readonly registry: SessionRegistry,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {}

  async append(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly EventDraft[]
  }): Promise<Event[]> {
    if (args.drafts.length === 0) return []
    const sessionDir = await this.sessionDirFor({ threadId: args.threadId })
    const handle = this.registry.handleFor({ sessionDir })
    return this.registry.enqueue({ handle, run: () => this.appendOnce({ sessionDir, args }) })
  }

  async replace(args: {
    threadId: ThreadId
    runId: RunId
    drafts: readonly EventDraft[]
  }): Promise<Event[]> {
    const sessionDir = await this.sessionDirFor({ threadId: args.threadId })
    const handle = this.registry.handleFor({ sessionDir })
    return this.registry.enqueue({ handle, run: () => this.replaceOnce({ sessionDir, args }) })
  }

  async read(args: { threadId: ThreadId; fromSeq?: number; upTo?: number }): Promise<Event[]> {
    const decoded = await this.readDecoded(args)
    return decoded.events
  }

  async readDecoded({
    threadId,
    fromSeq,
    upTo,
  }: {
    threadId: ThreadId
    fromSeq?: number
    upTo?: number
  }): Promise<DecodedSessionLog> {
    const sessionDir = await this.sessionDirFor({ threadId })
    const segments = planSegments({ home: this.home, sessionDir, threadId, upTo })

    const events: Event[] = []
    const unreadable: UnreadableRow[] = []
    const last = segments.length - 1
    for (const [index, segment] of segments.entries()) {
      if (fromSeq !== undefined && segment.upTo !== undefined && segment.upTo <= fromSeq) continue
      const all =
        index === last
          ? (await this.registry.readThreadLog({ sessionDir, threadId })).events
          : await this.registry.readParentEvents({ file: eventLogFile({ sessionDir: segment.sessionDir, threadId: segment.threadId }) })
      events.push(...sliceSegment({ events: all, fromSeq, upTo: segment.upTo }))
    }
    const own = await this.registry.readThreadLog({ sessionDir, threadId })
    return { events, unreadable: own.unreadable }
  }

  async readOwn({
    threadId,
    fromSeq,
    upTo,
  }: {
    threadId: ThreadId
    fromSeq?: number
    upTo?: number
  }): Promise<Event[]> {
    const sessionDir = await this.sessionDirFor({ threadId })
    const log = await this.registry.readThreadLog({ sessionDir, threadId })
    return sliceSegment({ events: log.events, fromSeq, upTo })
  }

  async head({ threadId }: { threadId: ThreadId }): Promise<number> {
    const sessionDir = await this.sessionDirFor({ threadId })
    const log = await this.registry.readThreadLog({ sessionDir, threadId })
    return log.head
  }

  async sessionDirFor({ threadId }: { threadId: ThreadId }): Promise<string> {
    return this.registry.sessionDirFor({ threadId })
  }

  private async appendOnce({
    sessionDir,
    args,
  }: {
    sessionDir: string
    args: {
      threadId: ThreadId
      runId: RunId
      parentRunId?: RunId | undefined
      depth?: number | undefined
      drafts: readonly EventDraft[]
    }
  }): Promise<Event[]> {
    const at = this.clock.now()
    const metaFile = threadMetaFile({ sessionDir, threadId: args.threadId })
    const meta = readMetaSync({ file: metaFile, schema: threadMetaSchema }) ?? newThreadMeta({ id: args.threadId, at })
    this.registry.registerThread({ sessionDir, threadId: args.threadId })

    const log = await this.registry.readThreadLog({ sessionDir, threadId: args.threadId })
    const reusable = await this.loadReusableContext({ threadId: args.threadId, drafts: args.drafts })
    const plan = planAppend({ drafts: args.drafts, reusable })
    if (plan.fresh.length === 0) return plan.resolve([])

    const firstSeq = log.head + 1
    const prepared = plan.fresh.map((draft, index) => {
      const envelope: EventEnvelope = {
        id: this.ids.nextEventId(),
        seq: firstSeq + index,
        threadId: args.threadId,
        runId: args.runId,
        depth: args.depth ?? 0,
        at,
        ...(args.parentRunId === undefined ? {} : { parentRunId: args.parentRunId }),
      }
      return { draft, envelope }
    })

    const lines = prepared.map((entry) => `${encodeEventLine(entry)}\n`).join('')
    const file = eventLogFile({ sessionDir, threadId: args.threadId })
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, lines, 'utf8')

    const stamped = stampDrafts({ drafts: prepared.map((entry) => entry.draft), envelopes: prepared.map((entry) => entry.envelope) })
    log.events.push(...stamped)
    log.head = firstSeq + prepared.length - 1
    for (const event of stamped) {
      const identity = contextIdentityOf(event)
      if (identity !== undefined) log.byContext.set(identity, event)
    }

    await writeMeta({ file: metaFile, meta: { ...meta, head: log.head, updatedAt: at } })
    return plan.resolve(stamped)
  }

  private async replaceOnce({
    sessionDir,
    args,
  }: {
    sessionDir: string
    args: { threadId: ThreadId; runId: RunId; drafts: readonly EventDraft[] }
  }): Promise<Event[]> {
    const at = this.clock.now()
    const metaFile = threadMetaFile({ sessionDir, threadId: args.threadId })
    const existing = readMetaSync({ file: metaFile, schema: threadMetaSchema })
    const floor = existing?.forkMode === EForkMode.Reference ? (existing.forkSeq ?? 0) : 0
    const prepared = args.drafts.map((draft, index) => {
      const envelope: EventEnvelope = {
        id: this.ids.nextEventId(),
        seq: floor + index + 1,
        threadId: args.threadId,
        runId: args.runId,
        depth: 0,
        at,
      }
      return { draft, envelope }
    })

    const file = eventLogFile({ sessionDir, threadId: args.threadId })
    await mkdir(dirname(file), { recursive: true })
    const tmp = join(threadsDirectory({ sessionDir }), `.replace.${process.pid}.tmp`)
    await writeFile(tmp, prepared.map((entry) => `${encodeEventLine(entry)}\n`).join(''))
    await rename(tmp, file)

    const stamped = stampDrafts({ drafts: prepared.map((entry) => entry.draft), envelopes: prepared.map((entry) => entry.envelope) })
    const log = await this.registry.readThreadLog({ sessionDir, threadId: args.threadId })
    log.events.length = 0
    log.events.push(...stamped)
    log.head = floor + stamped.length
    rebuildContextIndex({ log })

    const meta = existing ?? newThreadMeta({ id: args.threadId, at })
    await writeMeta({ file: metaFile, meta: { ...meta, head: log.head, updatedAt: at } })
    return stamped
  }

  private async loadReusableContext({
    threadId,
    drafts,
  }: {
    threadId: ThreadId
    drafts: readonly EventDraft[]
  }): Promise<ReadonlyMap<ContextIdentity, Event>> {
    const wanted = new Set<ContextIdentity>()
    for (const draft of drafts) {
      const identity = contextIdentityOf(draft)
      if (identity !== undefined) wanted.add(identity)
    }
    if (wanted.size === 0) return new Map()

    const reusable = new Map<ContextIdentity, Event>()
    const composed = await this.read({ threadId })
    for (const event of composed) {
      const identity = contextIdentityOf(event)
      if (identity !== undefined && wanted.has(identity)) reusable.set(identity, event)
    }
    return reusable
  }
}

function sliceSegment({
  events,
  fromSeq,
  upTo,
}: {
  events: readonly Event[]
  fromSeq?: number | undefined
  upTo?: number | undefined
}): Event[] {
  return events.filter((event) => {
    if (fromSeq !== undefined && event.seq <= fromSeq) return false
    if (upTo !== undefined && event.seq > upTo) return false
    return true
  })
}
