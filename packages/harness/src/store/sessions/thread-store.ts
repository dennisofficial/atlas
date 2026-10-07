import {
  EExecutionLocation,
  placementOf,
  toThreadId,
  type PlacementRecord,
  type ClockPort,
  type Event,
  type EventLogPort,
  type IdPort,
  type LogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { OpenThreadArgs } from '../create-with-events'
import type { ParkedTranscriptRecord } from '../../cloud/transcript-freshness'
import type { Unsubscribe } from '../../channel/delta-channel'
import type { ModelChosenListener, PlacementChangedListener, RenameListener, ThreadModel, ThreadStorePort, ThreadSummary, WritePlacementArgs } from '../thread-store'
import { metaWithParkedTranscript, parkedTranscriptOf } from './parked-transcript-meta'
import { placementRecordOf } from './placement-meta'
import { findNamedRoot, listRoots, mostRecentRoot, readThreadMetas, toThreadSummary, tryReadThreadMeta } from './listing'
import { writeMeta } from './meta'
import type { SessionRegistry } from './registry'
import { threadMetaFile } from './paths'
import { writeSessionMetaForRoot } from './session-meta'
import type { ForkArgs, MarkArgs, RewindArgs, ThreadStoreContext } from './thread-store-context'
import { blankMeta, sessionDirFor, sessionDirForNew } from './thread-store-fields'
import { forkThread, markThreadHistory, rewindThread } from './thread-store-history'
import { updateThreadMeta, writePlacementMeta } from './thread-store-mutations'

export class ThreadNeedsOpeningDrafts extends Error {
  constructor() {
    super(
      'a thread opened with its first events must be given at least one draft: an empty log reads as no one having spoken, so the thread would exist unable to ever take a step',
    )
    this.name = 'ThreadNeedsOpeningDrafts'
  }
}

export class JsonlThreadStore implements ThreadStorePort {
  private readonly renameListeners = new Set<RenameListener>()
  private readonly modelChosenListeners = new Set<ModelChosenListener>()
  private readonly placementListeners = new Set<PlacementChangedListener>()

  constructor(
    private readonly home: string,
    private readonly registry: SessionRegistry,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
    private readonly log: EventLogPort,
    private readonly trace?: LogPort | undefined,
  ) {}

  onRename(listener: RenameListener): Unsubscribe {
    this.renameListeners.add(listener)
    return () => this.renameListeners.delete(listener)
  }

  onModelChosen(listener: ModelChosenListener): Unsubscribe {
    this.modelChosenListeners.add(listener)
    return () => this.modelChosenListeners.delete(listener)
  }

  async create(args: Parameters<ThreadStorePort['create']>[0]): Promise<ThreadSummary> {
    const meta = blankMeta({ clock: this.clock, threadId: args.id ?? this.ids.nextThreadId(), fields: args })
    const sessionDir = await sessionDirForNew({ context: this.context(), id: toThreadId(meta.id), agent: args.agent })
    await writeMeta({ file: threadMetaFile({ sessionDir, threadId: toThreadId(meta.id) }), meta })
    this.registry.registerThread({ sessionDir, threadId: toThreadId(meta.id) })
    if (args.agent === undefined) await writeSessionMetaForRoot({ registry: this.registry, sessionDir, root: meta, home: EExecutionLocation.Host })
    return toThreadSummary(meta)
  }

  async createWithFirstEvents(args: OpenThreadArgs): Promise<{ thread: ThreadSummary; events: Event[] }> {
    if (args.drafts.length === 0) throw new ThreadNeedsOpeningDrafts()
    const threadId = args.threadId ?? this.ids.nextThreadId()
    const meta = blankMeta({ clock: this.clock, threadId, fields: { ...args, id: threadId } })
    const sessionDir = await sessionDirForNew({ context: this.context(), id: threadId, agent: args.agent })
    await writeMeta({ file: threadMetaFile({ sessionDir, threadId }), meta })
    this.registry.registerThread({ sessionDir, threadId })
    if (args.agent === undefined) {
      const home = args.executionLocation ?? EExecutionLocation.Host
      await writeSessionMetaForRoot({ registry: this.registry, sessionDir, root: meta, home })
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
    const metas = await readThreadMetas({ sessionDir: await sessionDirFor({ context: this.context(), threadId }) })
    return metas
      .filter((meta) => meta.spawnerThreadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(toThreadSummary)
  }

  async mostRecent({ project }: { project: string }): Promise<ThreadSummary | undefined> {
    return mostRecentRoot({ home: this.home, project })
  }

  async list(args: {
    project: string
    limit?: number | undefined
    enrich?: readonly ThreadId[] | undefined
    onUpdate?: ((threads: readonly ThreadSummary[]) => void) | undefined
  }): Promise<readonly ThreadSummary[]> {
    return listRoots({
      home: this.home,
      project: args.project,
      limit: args.limit,
      enrich: args.enrich,
      onUpdate: args.onUpdate,
    })
  }

  async findNamed(args: { project: string; handle: string }): Promise<ThreadSummary | undefined> {
    return findNamedRoot({ home: this.home, project: args.project, handle: args.handle })
  }

  async rename({ threadId, title }: { threadId: ThreadId; title: string }): Promise<void> {
    const sessionDir = await this.registry.sessionDirOf({ threadId })
    if (sessionDir === undefined) return
    await updateThreadMeta({ context: this.context(), threadId, change: (meta) => ({ ...meta, title }) })
    if (process.env.ATLAS_TRACE_TITLING !== undefined) {
      this.trace?.info({
        source: 'titling.trace',
        message: 'store rename',
        threadId,
        data: { title, listeners: this.renameListeners.size },
      })
    }
    for (const listener of [...this.renameListeners]) listener({ threadId, title })
  }

  onPlacementChanged(listener: PlacementChangedListener): Unsubscribe {
    this.placementListeners.add(listener)
    return () => this.placementListeners.delete(listener)
  }

  async readPlacement({ threadId }: { threadId: ThreadId }): Promise<PlacementRecord | undefined> {
    const sessionDir = await this.registry.sessionDirOf({ threadId })
    if (sessionDir === undefined) return undefined
    const meta = tryReadThreadMeta({ file: threadMetaFile({ sessionDir, threadId }) })
    return meta === undefined ? undefined : placementRecordOf(meta)
  }

  async writePlacement(args: WritePlacementArgs): Promise<void> {
    await writePlacementMeta({ context: this.context(), args })
    for (const listener of [...this.placementListeners]) listener({ threadId: args.threadId, record: args.record })
  }

  async writeParkedTranscript(args: { threadId: ThreadId; record: ParkedTranscriptRecord }): Promise<void> {
    await updateThreadMeta({
      context: this.context(),
      threadId: args.threadId,
      change: (meta) => metaWithParkedTranscript({ meta, record: args.record }),
    })
  }

  async readParkedTranscript(args: { threadId: ThreadId }): Promise<ParkedTranscriptRecord | null> {
    const sessionDir = await this.registry.sessionDirOf({ threadId: args.threadId })
    if (sessionDir === undefined) return null
    const meta = tryReadThreadMeta({
      file: threadMetaFile({ sessionDir, threadId: args.threadId }),
    })
    return meta === undefined ? null : parkedTranscriptOf(meta)
  }

  async chooseModel({
    threadId,
    model,
    retarget,
  }: {
    threadId: ThreadId
    model: ThreadModel
    retarget?: boolean | undefined
  }): Promise<void> {
    const sessionDir = await this.registry.sessionDirOf({ threadId })
    if (sessionDir === undefined) return
    await updateThreadMeta({
      context: this.context(),
      threadId,
      change: (meta) => {
        const frozen = meta.spawnerThreadId !== null && meta.modelRef !== null && meta.modelEffort !== null
        if (frozen && retarget !== true && (meta.modelRef !== model.ref || meta.modelEffort !== model.effort))
          throw new Error(`child ${threadId} keeps the model and effort it was spawned with`)
        return { ...meta, modelRef: model.ref, modelEffort: model.effort }
      },
    })
    for (const listener of [...this.modelChosenListeners]) listener({ threadId, model })
  }

  async chooseExecutionLocation(args: { threadId: ThreadId; location: EExecutionLocation }): Promise<void> {
    const { threadId, location } = args
    const known = await this.registry.sessionDirOf({ threadId })
    if (known === undefined && location === EExecutionLocation.Host) return

    const held = await this.readPlacement({ threadId })
    await this.writePlacement({
      threadId,
      record: {
        placement: placementOf(location),
        revision: held?.revision ?? 0,
        move: held?.move ?? null,
      },
    })
  }

  async adopt({ threadId, workspace, repo }: { threadId: ThreadId; workspace: string; repo: string | null }): Promise<void> {
    await updateThreadMeta({ context: this.context(), threadId, change: (meta) => ({ ...meta, workspace, repo }) })
  }

  async rewind(args: RewindArgs): Promise<void> {
    await rewindThread({ context: this.context(), args })
  }

  async compact(args: MarkArgs): Promise<number> {
    return markThreadHistory({ context: this.context(), args: { ...args, discardRows: false, cutAgents: [] } })
  }

  async summarise(args: MarkArgs & { cutAgents?: readonly ThreadId[] | undefined }): Promise<number> {
    return markThreadHistory({ context: this.context(), args: { ...args, cutAgents: args.cutAgents ?? [], discardRows: true } })
  }

  async fork(args: ForkArgs): Promise<ThreadSummary> {
    return forkThread({ context: this.context(), args })
  }

  private context(): ThreadStoreContext {
    return { home: this.home, registry: this.registry, clock: this.clock, ids: this.ids, log: this.log }
  }
}
