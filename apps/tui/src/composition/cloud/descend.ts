import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  mergePublishedWorkspace,
  publishedWorkspaceWireSchema,
  relocateSession,
  type MergedWorkspace,
  type PublishedWorkspaceWire,
} from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'
import { EOpenMode } from '../config'
import { messageOf } from '../error-text'
import { openConversation, type OpenedConversation } from '../open-conversation'
import { ELocalMoveStep } from '../container-move'
import type { ContainerMoveControl } from '../use-container-move'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { draftsOf } from './event-drafts'
import { ELiftStep } from './lift'
import { flipChildrenBack } from './lift-children'
import { descendedConflictsDraft } from './transition-notice'

const DESCEND_DESTROY_NOTICE_KEY = 'descend-sandbox-destroy-failed'

const INTERRUPT_DEADLINE_MS = 30_000

export type DescendLocalHome = Pick<
  AtlasApp,
  'threads' | 'log' | 'ledger' | 'agents' | 'ids' | 'workspace' | 'services'
>

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

  await localApp.log.replace({
    threadId,
    runId: localApp.ids.nextRunId(),
    drafts: draftsOf(events),
  })

  const remote = await bridge.stores.threads.find({ threadId })
  if (remote?.model !== undefined) {
    await localApp.threads.chooseModel({ threadId, model: remote.model })
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
}) => Promise<MergedWorkspace>

async function publishWorkspaceHome(args: {
  channel: CloudChannel
}): Promise<PublishedWorkspaceWire> {
  const result = await args.channel.request({ op: EClientRequest.PublishWorkspace, params: {} })
  return publishedWorkspaceWireSchema.parse(result)
}

/**
 * Bringing a cloud conversation home: stop the remote turn at a clean break, move the log's home
 * back (the cloud tail the local store missed, then the relocation marker into the local log),
 * flip both stores, and hand back the locally-opened conversation. Any failure before the flip
 * leaves the cloud session attached and the conversation exactly where it was.
 */
export async function descendFromCloud(args: {
  threadId: ThreadId
  target: EExecutionLocation
  midTurn: boolean
  bridge: CloudBridge
  channel: CloudChannel
  localApp: DescendLocalHome
  move: ContainerMoveControl
  interruptDeadlineMs?: number | undefined
  mergeWorkspace?: WorkspaceMerger | undefined
}): Promise<OpenedConversation> {
  const { threadId, target, bridge, channel, localApp, move } = args

  move.handleBegin({
    target,
    plan: args.midTurn
      ? [
          ELiftStep.Interrupting,
          ELiftStep.Transferring,
          ELiftStep.Flipping,
          ELocalMoveStep.Relocating,
        ]
      : [ELiftStep.Transferring, ELiftStep.Flipping, ELocalMoveStep.Relocating],
  })

  if (args.midTurn) {
    move.handleAdvance(ELiftStep.Interrupting)
    channel.interrupt()
    const settled = await awaitTurnEnd({
      channel,
      deadlineMs: args.interruptDeadlineMs ?? INTERRUPT_DEADLINE_MS,
    })
    if (!settled) throw new Error('the turn would not stop in time — nothing moved')
  }

  move.handleAdvance(ELiftStep.Transferring)
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
        })

  move.handleAdvance(ELiftStep.Flipping)
  await localApp.threads.chooseExecutionLocation({ threadId, location: target })
  await bridge.stores.threads
    .chooseExecutionLocation({ threadId, location: target })
    .catch(() => undefined)
  await flipChildrenBack({ threadId, bridge, agents: localApp.agents, location: target })

  move.handleAdvance(ELocalMoveStep.Relocating)
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
  if (merged.conflicts.length > 0) {
    await localApp.log.append({
      threadId,
      runId: localApp.ids.nextRunId(),
      drafts: [descendedConflictsDraft({ conflicts: merged.conflicts })],
    })
  }

  const opened = await openConversation({
    threads: localApp.threads,
    remoteThreads: bridge.stores.threads,
    log: localApp.log,
    ledger: localApp.ledger,
    agents: localApp.agents,
    ids: localApp.ids,
    workspace: localApp.workspace,
    open: { mode: EOpenMode.Resume, threadId },
  })
  if (!opened.ok) throw new Error(opened.reason)

  await bridge.sandboxes.destroy({ threadId }).catch((error: unknown) => {
    notify({
      key: DESCEND_DESTROY_NOTICE_KEY,
      text: `this conversation is home, but its cloud sandbox could not be torn down — ${messageOf(error)}`,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
    })
  })

  return args.midTurn ? { ...opened.conversation, resumeOnArrival: true } : opened.conversation
}
