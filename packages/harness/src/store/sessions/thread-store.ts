import {
  ECompactionAnchor,
  EExecutionLocation,
  EForkMode,
  SURVIVES_SUMMARY,
  executionLocationOf,
  stampEvent,
  toThreadId,
  type ClockPort,
  type Event,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { OpenThreadArgs } from '../create-with-events'
import { ForkSeqOutOfRange, ForkSourceMissing } from '../fork'
import type { SupervisedAgent, ThreadModel, ThreadStorePort, ThreadSummary } from '../thread-store'
import {
  dropRewoundChildren,
  findNamedRoot,
  listRoots,
  mostRecentRoot,
  readThreadMetas,
  toThreadSummary,
  touchThreadMeta,
  tryReadThreadMeta,
  writeSessionMetaForRoot,
} from './listing'
import { newThreadMeta, readMetaSync, sessionMetaSchema, writeMeta, type ThreadMeta } from './meta'
import { sessionDirectory, sessionMetaFile, threadMetaFile } from './paths'
import type { SessionRegistry } from './registry'
import { appendStampedEvent, rewriteThreadLog } from './thread-places'

export class ThreadNeedsOpeningDrafts extends Error {
  constructor() {
    super(
      'a thread opened with its first events must be given at least one draft: an empty log reads as no one having spoken, so the thread would exist unable to ever take a step',
    )
    this.name = 'ThreadNeedsOpeningDrafts'
  }
}

type CreateArgs = {
  title?: string | undefined
  workspace?: string | undefined
  repo?: string | null | undefined
  agent?: SupervisedAgent | undefined
}

type MarkArgs = { threadId: ThreadId; anchor: ECompactionAnchor; fromSeq: number; throughSeq: number; summary: string }

type RewindArgs = { threadId: ThreadId; toSeq: number; cutAgents?: readonly ThreadId[] | undefined }

type ForkArgs = { from: ThreadId; seq: number; mode: EForkMode; title?: string | undefined }

export class JsonlThreadStore implements ThreadStorePort {
  constructor(
    private readonly home: string,
    private readonly registry: SessionRegistry,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
    private readonly log: EventLogPort,
  ) {}

  async create(args: CreateArgs): Promise<ThreadSummary> {
    const meta = this.blankMeta({ threadId: this.ids.nextThreadId(), fields: args })
    const sessionDir = await this.sessionDirForNew({ id: toThreadId(meta.id), agent: args.agent })
    await writeMeta({ file: threadMetaFile({ sessionDir, threadId: toThreadId(meta.id) }), meta })
    this.registry.registerThread({ sessionDir, threadId: toThreadId(meta.id) })
    if (args.agent === undefined) await writeSessionMetaForRoot({ sessionDir, root: meta, home: EExecutionLocation.Host })
    return toThreadSummary(meta)
  }

  async createWithFirstEvents(args: OpenThreadArgs): Promise<{ thread: ThreadSummary; events: Event[] }> {
    if (args.drafts.length === 0) throw new ThreadNeedsOpeningDrafts()
    const threadId = args.threadId ?? this.ids.nextThreadId()
    const meta = this.blankMeta({ threadId, fields: args })
    const sessionDir = await this.sessionDirForNew({ id: threadId, agent: args.agent })
    await writeMeta({ file: threadMetaFile({ sessionDir, threadId }), meta })
    this.registry.registerThread({ sessionDir, threadId })
    if (args.agent === undefined) {
      const home = args.executionLocation ?? EExecutionLocation.Host
      await writeSessionMetaForRoot({ sessionDir, root: meta, home })
    }
    const events = await this.log.append({ threadId, runId: args.runId, drafts: args.drafts })
    const stored = tryReadThreadMeta({ file: threadMetaFile({ sessionDir, threadId }) })
    return { thread: toThreadSummary(stored ?? meta), events }
  }

  async find({ threadId }: { threadId: ThreadId }): Promise<ThreadSummary | undefined> {
    const sessionDir = await this.registry.sessionDirOf({ threadId })
    const meta = sessionDir === undefined ? undefined : tryReadThreadMeta({ file: threadMetaFile({ sessionDir, threadId }) })
    return meta === undefined ? undefined : toThreadSummary(meta)
  }

  async spawned({ threadId }: { threadId: ThreadId }): Promise<readonly ThreadSummary[]> {
    const metas = await readThreadMetas({ sessionDir: await this.sessionDirFor({ threadId }) })
    return metas
      .filter((meta) => meta.spawnerThreadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(toThreadSummary)
  }

  async mostRecent({ project }: { project: string }): Promise<ThreadSummary | undefined> {
    return mostRecentRoot({ home: this.home, project })
  }

  async list(args: { project: string; limit?: number | undefined }): Promise<readonly ThreadSummary[]> {
    return listRoots({ home: this.home, registry: this.registry, project: args.project, limit: args.limit })
  }

  async findNamed(args: { project: string; handle: string }): Promise<ThreadSummary | undefined> {
    return findNamedRoot({ home: this.home, project: args.project, handle: args.handle })
  }

  async rename({ threadId, title }: { threadId: ThreadId; title: string }): Promise<void> {
    await this.updateMeta({ threadId, change: (meta) => ({ ...meta, title }) })
  }

  async chooseModel({ threadId, model }: { threadId: ThreadId; model: ThreadModel }): Promise<void> {
    await this.updateMeta({
      threadId,
      change: (meta) => ({ ...meta, modelRef: model.ref, modelEffort: model.effort }),
    })
  }

  async chooseExecutionLocation(args: { threadId: ThreadId; location: EExecutionLocation }): Promise<void> {
    await this.updateMeta({
      threadId: args.threadId,
      change: (meta) => ({ ...meta, executionLocation: args.location }),
    })
  }

  async adopt({ threadId, workspace, repo }: { threadId: ThreadId; workspace: string; repo: string | null }): Promise<void> {
    await this.updateMeta({ threadId, change: (meta) => ({ ...meta, workspace, repo }) })
  }

  async rewind({ threadId, toSeq, cutAgents = [] }: RewindArgs): Promise<void> {
    const sessionDir = await this.sessionDirFor({ threadId })
    const handle = this.registry.handleFor({ sessionDir })
    await this.registry.enqueue({
      handle,
      run: async () => {
        const log = await this.registry.readThreadLog({ sessionDir, threadId })
        await rewriteThreadLog({
          registry: this.registry,
          ids: this.ids,
          sessionDir,
          threadId,
          events: log.events.filter((event) => event.seq <= toSeq),
        })
        await dropRewoundChildren({ home: this.home, registry: this.registry, agentIds: cutAgents })
        await touchThreadMeta({ registry: this.registry, sessionDir, threadId, at: this.clock.now() })
      },
    })
  }

  async compact(args: MarkArgs): Promise<number> {
    return this.mark({ ...args, discardRows: false, cutAgents: [] })
  }

  async summarise(args: MarkArgs & { cutAgents?: readonly ThreadId[] | undefined }): Promise<number> {
    return this.mark({ ...args, cutAgents: args.cutAgents ?? [], discardRows: true })
  }

  async fork({ from, seq, mode, title }: ForkArgs): Promise<ThreadSummary> {
    const fromDir = await this.sessionDirFor({ threadId: from })
    const handle = this.registry.handleFor({ sessionDir: fromDir })
    return this.registry.enqueue({
      handle,
      run: async () => {
        const source = tryReadThreadMeta({ file: threadMetaFile({ sessionDir: fromDir, threadId: from }) })
        if (source === undefined) throw new ForkSourceMissing({ from })
        const head = (await this.registry.readThreadLog({ sessionDir: fromDir, threadId: from })).head
        if (seq < 0 || seq > head) throw new ForkSeqOutOfRange({ from, seq, head })
        const into = this.ids.nextThreadId()
        const sessionDir = sessionDirectory({ home: this.home, sessionId: into })
        const meta: ThreadMeta = {
          ...this.blankMeta({ threadId: into, fields: { title, repo: source.repo } }),
          head: seq,
          parentThreadId: from,
          forkSeq: seq,
          forkMode: mode,
          workspace: source.workspace,
          modelRef: source.modelRef,
          modelEffort: source.modelEffort,
          executionLocation: source.executionLocation,
        }
        if (mode === EForkMode.Copy) {
          const prefix = await this.log.read({ threadId: from, upTo: seq })
          await rewriteThreadLog({ registry: this.registry, ids: this.ids, sessionDir, threadId: into, events: prefix })
          meta.head = prefix.at(-1)?.seq ?? 0
        }
        await writeMeta({ file: threadMetaFile({ sessionDir, threadId: into }), meta })
        this.registry.registerThread({ sessionDir, threadId: into })
        await writeSessionMetaForRoot({ sessionDir, root: meta, home: this.homeOf({ source, fromDir }) })
        return toThreadSummary(meta)
      },
    })
  }

  private async mark(args: MarkArgs & { discardRows: boolean; cutAgents: readonly ThreadId[] }): Promise<number> {
    const { threadId, anchor, fromSeq, throughSeq, summary, discardRows, cutAgents } = args
    const sessionDir = await this.sessionDirFor({ threadId })
    const handle = this.registry.handleFor({ sessionDir })
    return this.registry.enqueue({
      handle,
      run: async () => {
        const at = this.clock.now()
        const log = await this.registry.readThreadLog({ sessionDir, threadId })
        const vacated = log.events
          .filter((event) => event.seq >= fromSeq && event.seq <= throughSeq && !SURVIVES_SUMMARY.includes(event.type))
          .map((event) => event.seq)
        const standIn = discardRows
          ? anchor === ECompactionAnchor.Prefix
            ? vacated.at(-1)
            : vacated[0]
          : undefined
        const watermark = stampEvent({
          draft: { type: 'history-compacted', anchor, fromSeq, throughSeq, summary, replaced: vacated.length },
          envelope: { id: this.ids.nextEventId(), seq: standIn ?? log.head + 1, threadId, runId: this.ids.nextRunId(), depth: 0, at },
        })
        if (!discardRows) {
          await appendStampedEvent({ registry: this.registry, sessionDir, event: watermark })
        } else {
          const removed = new Set(vacated)
          const merged = [...log.events.filter((event) => !removed.has(event.seq)), watermark].sort(
            (a, b) => a.seq - b.seq,
          )
          await rewriteThreadLog({ registry: this.registry, ids: this.ids, sessionDir, threadId, events: merged })
          await dropRewoundChildren({ home: this.home, registry: this.registry, agentIds: cutAgents })
        }
        await touchThreadMeta({ registry: this.registry, sessionDir, threadId, at })
        return vacated.length
      },
    })
  }

  private async updateMeta({
    threadId,
    change,
  }: {
    threadId: ThreadId
    change: (meta: ThreadMeta) => ThreadMeta
  }): Promise<void> {
    const sessionDir = await this.registry.sessionDirOf({ threadId })
    if (sessionDir === undefined) return
    const file = threadMetaFile({ sessionDir, threadId })
    const meta = tryReadThreadMeta({ file })
    if (meta === undefined) return
    const next = change(meta)
    await writeMeta({ file, meta: next })
    if (sessionDir.endsWith(`/${threadId}`)) {
      await writeSessionMetaForRoot({ sessionDir, root: next, home: this.homeOf({ source: next, fromDir: sessionDir }) })
    }
  }

  private homeOf({ source, fromDir }: { source: ThreadMeta; fromDir: string }): EExecutionLocation {
    const session = readMetaSync({ file: sessionMetaFile({ sessionDir: fromDir }), schema: sessionMetaSchema })
    const home = executionLocationOf(session?.home) ?? executionLocationOf(source.executionLocation)
    return home ?? EExecutionLocation.Host
  }

  private blankMeta({
    threadId,
    fields,
  }: {
    threadId: ThreadId
    fields: CreateArgs & { executionLocation?: EExecutionLocation | undefined }
  }): ThreadMeta {
    const meta = newThreadMeta({ id: threadId, at: this.clock.now() })
    if (fields.title !== undefined) meta.title = fields.title
    if (fields.workspace !== undefined) meta.workspace = fields.workspace
    if (fields.repo !== undefined) meta.repo = fields.repo
    if (fields.executionLocation !== undefined) meta.executionLocation = fields.executionLocation
    if (fields.agent !== undefined) {
      meta.spawnerThreadId = fields.agent.spawnedBy
      meta.agentType = fields.agent.type
    }
    return meta
  }

  private async sessionDirForNew({
    id,
    agent,
  }: {
    id: ThreadId
    agent: SupervisedAgent | undefined
  }): Promise<string> {
    if (agent === undefined) return sessionDirectory({ home: this.home, sessionId: id })
    return this.sessionDirFor({ threadId: agent.spawnedBy })
  }

  private async sessionDirFor({ threadId }: { threadId: ThreadId }): Promise<string> {
    const resolved = await this.registry.sessionDirOf({ threadId })
    if (resolved !== undefined) return resolved
    return sessionDirectory({ home: this.home, sessionId: threadId })
  }
}
