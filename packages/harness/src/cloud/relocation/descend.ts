import {
  ENoticeTone,
  EExecutionLocation,
  type EventLogPort,
  type IdPort,
  type NoticePort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../../agents/registry/port'
import type { ServiceRegistryPort } from '../../services/service-registry'
import type { ToolRegistry } from '../../tools/registry'
import { EClientRequest, publishedWorkspaceWireSchema, type PublishedWorkspaceWire } from '../channel-wire'
import type { RemoteMemoryMerge } from '../merge-remote-memory'
import type { ThreadStorePort } from '../../store/thread-store'
import { relocateSession } from '../../store/relocate-session'
import type { TurnLedgerPort } from '../../ledger/turn-ledger.port'
import { mergePublishedWorkspace, type MergedWorkspace } from '../../workspace/merge-published'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { draftsOf } from './event-drafts'
import { ELiftStep } from './lift'
import { flipChildrenBack } from './lift-children'
import { assertTransferred } from './transfer-verification'
import {
  descendedConflictsDraft,
  descendedMemoryConflictsDraft,
  descendedSupersededDraft,
} from './transition-notice'

export enum EDescendStep {
  Transferring = 'transferring',
  Flipping = 'flipping',
  Relocating = 'relocating',
}

export type DescendProgressStep = ELiftStep.Interrupting | EDescendStep

export const DESCEND_DESTROY_NOTICE_KEY = 'descend-sandbox-destroy-failed'

export const DESCEND_MEMORY_NOTICE_KEY = 'descend-memory-pull-failed'

export const DESCEND_FLIP_BACK_NOTICE_KEY = 'descend-remote-flip-failed'

const INTERRUPT_DEADLINE_MS = 30_000

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const NO_PROTECTION = (): void => undefined

const nullNotice: NoticePort = { notify: () => undefined }

/**
 * The ports on the side the conversation is coming home to, cut down to what the descend touches.
 * `services` and `agents` come from the target session's own registry ports; `tools`/`ledger`
 * are carried so the surface can reopen the conversation from the same bag it handed in.
 */
export type DescendLocalHome = {
  threads: ThreadStorePort
  log: EventLogPort
  ledger: TurnLedgerPort
  agents: AgentRegistryPort
  ids: IdPort
  workspace: WorkspaceIdentity
  services: ServiceRegistryPort
  tools: ToolRegistry
}

/**
 * The surface's part of a descend: progress steps, operator notices, and the reopen. A session
 * that came home without its local half being reopened is half a descend, so `openLocal` is
 * required and its failure fails the move; `protect` is the surface's chance to hold the session
 * in place (the TUI dims it under the move overlay) from the first step until the descend returns.
 */
export type DescendSurface<Opened> = {
  notice: NoticePort
  onBegin?: ((args: { plan: readonly DescendProgressStep[] }) => void) | undefined
  onProgress?: ((step: DescendProgressStep) => void) | undefined
  protect?: (() => () => void) | undefined
  openLocal: (home: DescendLocalHome, threadId: ThreadId) => Promise<Opened>
}

/**
 * The cloud is the log's home while the conversation is away, so coming home replaces the local
 * log with it wholesale rather than appending a tail onto a snapshot that could have drifted. The
 * one refusal: the cloud holding nothing while the local log holds something can only mean the
 * transfer up never landed, and replacing would erase the conversation.
 */
async function transferThreadDown(args: {
  threadId: ThreadId
  target: EExecutionLocation
  bridge: CloudBridge
  localApp: DescendLocalHome
}): Promise<void> {
  const { threadId, bridge, localApp, target } = args
  const events = await bridge.stores.log.read({ threadId })
  const local = await localApp.threads.find({ threadId })

  if (local === undefined) {
    const remote = await bridge.stores.threads.find({ threadId })
    await localApp.threads.createWithFirstEvents({
      threadId,
      runId: localApp.ids.nextRunId(),
      drafts: draftsOf(events),
      executionLocation: target,
      ...(remote?.title === undefined ? {} : { title: remote.title }),
      ...(remote?.workspace === null || remote?.workspace === undefined
        ? {}
        : { workspace: remote.workspace }),
      ...(remote?.repo === undefined ? {} : { repo: remote.repo }),
      ...(remote?.agent === undefined ? {} : { agent: remote.agent }),
    })
    if (remote?.model !== undefined) {
      await localApp.threads.chooseModel({ threadId, model: remote.model })
    }
    return
  }

  if (events.length === 0) {
    if ((await localApp.log.head({ threadId })) > 0) {
      throw new Error(
        'the cloud holds no events for this conversation but the local log does — refusing to wipe them',
      )
    }
    return
  }

  const replaced = await localApp.log.replace({
    threadId,
    runId: localApp.ids.nextRunId(),
    drafts: draftsOf(events),
  })

  await assertTransferred({
    log: localApp.log,
    threadId,
    expectedHead: replaced.at(-1)?.seq ?? 0,
    expectedCount: events.length,
    side: 'local',
  })

  const remote = await bridge.stores.threads.find({ threadId })
  if (remote?.model !== undefined) {
    await localApp.threads.chooseModel({ threadId, model: remote.model })
  }
  if (remote?.title !== undefined && local.title !== remote.title) {
    await localApp.threads.rename({ threadId, title: remote.title })
  }
}

const awaitTurnEnd = (args: { channel: CloudChannel; deadlineMs: number }): Promise<boolean> =>
  new Promise((resolve) => {
    const unsubscribe = args.channel.onTurnEnded(() => {
      clearTimeout(timer)
      unsubscribe()
      resolve(true)
    })
    const timer = setTimeout(() => {
      unsubscribe()
      resolve(false)
    }, args.deadlineMs)
  })

export type WorkspaceMerger = (args: {
  cwd: string
  ref: string
  base: string | null
  baseTree: string | null
  branch: string | null
}) => Promise<MergedWorkspace>

async function publishWorkspaceHome(args: {
  channel: CloudChannel
}): Promise<PublishedWorkspaceWire> {
  const result = await args.channel.request({ op: EClientRequest.PublishWorkspace, params: {} })
  return publishedWorkspaceWireSchema.parse(result)
}

const planFor = (midTurn: boolean): readonly DescendProgressStep[] =>
  midTurn
    ? [ELiftStep.Interrupting, EDescendStep.Transferring, EDescendStep.Flipping, EDescendStep.Relocating]
    : [EDescendStep.Transferring, EDescendStep.Flipping, EDescendStep.Relocating]

/**
 * Bringing a cloud conversation home: stop the remote turn at a clean break, move the log's home
 * back (the cloud tail the local store missed, then the relocation marker into the local log),
 * flip both stores, and hand back the locally-reopened conversation. Any failure before the flip
 * leaves the cloud session attached and the conversation exactly where it was.
 */
export async function descendFromCloud<Opened>(args: {
  threadId: ThreadId
  target: EExecutionLocation
  midTurn: boolean
  bridge: CloudBridge
  channel: CloudChannel
  localApp: DescendLocalHome
  surface: DescendSurface<Opened>
  interruptDeadlineMs?: number | undefined
  mergeWorkspace?: WorkspaceMerger | undefined
  /**
   * Pulls the cloud's memory archive down over the local one — the cloud copy is newer at descend.
   * Optional so a spec never fetches; a failure warns and never blocks the descend. Conflicts the
   * local copy won come back so their cloud versions can be kept in the log, never dropped.
   */
  pullMemory?: (() => Promise<RemoteMemoryMerge>) | undefined
}): Promise<Opened> {
  const { threadId, target, bridge, channel, localApp, surface } = args
  const notice = surface.notice ?? nullNotice

  surface.onBegin?.({ plan: planFor(args.midTurn) })
  const release = surface.protect === undefined ? NO_PROTECTION : surface.protect()
  try {
    if (args.midTurn) {
      surface.onProgress?.(ELiftStep.Interrupting)
      channel.interrupt()
      const settled = await awaitTurnEnd({
        channel,
        deadlineMs: args.interruptDeadlineMs ?? INTERRUPT_DEADLINE_MS,
      })
      if (!settled) throw new Error('the turn would not stop in time — nothing moved')
    }

    surface.onProgress?.(EDescendStep.Transferring)
    await transferThreadDown({ threadId, target, bridge, localApp })
    const children = await bridge.stores.threads.spawned({ threadId })
    for (const child of children) {
      await transferThreadDown({ threadId: child.id, target, bridge, localApp })
    }

    const published = await publishWorkspaceHome({ channel })
    const merged: MergedWorkspace =
      published === null
        ? { conflicts: [] }
        : await (args.mergeWorkspace ?? mergePublishedWorkspace)({
            cwd: localApp.workspace.workspace,
            ref: published.ref,
            base: published.base,
            baseTree: published.baseTree ?? null,
            branch: published.branch ?? null,
          })

    if (args.pullMemory !== undefined) {
      const pulled = await args.pullMemory().catch((error: unknown) => {
        notice.notify({
          key: DESCEND_MEMORY_NOTICE_KEY,
          text: `this conversation is home, but the cloud's memory did not come down with it — ${messageOf(error)}`,
          tone: ENoticeTone.Warn,
          ttlMs: null,
        })
        return null
      })
      if (pulled !== null && pulled.conflicts.length > 0) {
        await localApp.log.append({
          threadId,
          runId: localApp.ids.nextRunId(),
          drafts: [descendedMemoryConflictsDraft({ conflicts: pulled.conflicts })],
        })
      }
    }

    surface.onProgress?.(EDescendStep.Flipping)
    await localApp.threads.chooseExecutionLocation({ threadId, location: target })
    await bridge.stores.threads
      .chooseExecutionLocation({ threadId, location: target })
      .catch((error: unknown) => {
        notice.notify({
          key: DESCEND_FLIP_BACK_NOTICE_KEY,
          text: `this conversation is home, but the cloud row still claims it runs in the cloud — ${messageOf(error)}. The next attach will reconcile it.`,
          tone: ENoticeTone.Warn,
          ttlMs: null,
        })
      })
    await flipChildrenBack({ threadId, bridge, agents: localApp.agents, location: target })

    surface.onProgress?.(EDescendStep.Relocating)
    await relocateSession({
      threadId,
      from: EExecutionLocation.Cloud,
      location: target,
      ...(target === EExecutionLocation.Host ? { cwd: localApp.workspace.workspace } : {}),
      log: localApp.log,
      ids: localApp.ids,
      services: localApp.services,
      agents: localApp.agents,
    })
    if (merged.conflicts.length > 0 || merged.superseded !== undefined) {
      await localApp.log.append({
        threadId,
        runId: localApp.ids.nextRunId(),
        drafts: [
          ...(merged.conflicts.length > 0
            ? [descendedConflictsDraft({ conflicts: merged.conflicts })]
            : []),
          ...(merged.superseded === undefined
            ? []
            : [descendedSupersededDraft({ superseded: merged.superseded })]),
        ],
      })
    }

    const opened = await surface.openLocal(localApp, threadId)

    await bridge.sandboxes.destroy({ threadId }).catch((error: unknown) => {
      notice.notify({
        key: DESCEND_DESTROY_NOTICE_KEY,
        text: `this conversation is home, but its cloud sandbox could not be torn down — ${messageOf(error)}`,
        tone: ENoticeTone.Warn,
        ttlMs: null,
      })
    })

    return opened
  } finally {
    release()
  }
}
