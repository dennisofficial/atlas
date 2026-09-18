import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  relocateSession,
  runGit,
  type WorkspaceSnapshot,
} from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'
import { EOpenMode } from '../config'
import { openConversation, type OpenedConversation } from '../open-conversation'
import { ELocalMoveStep } from '../container-move'
import type { ContainerMoveControl } from '../use-container-move'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { draftsOf } from './event-drafts'
import { ELiftStep } from './lift'
import { flipChildrenBack } from './lift-children'

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

async function captureWorkspaceFromCloud(args: {
  channel: CloudChannel
  cwd: string
}): Promise<WorkspaceSnapshot | null> {
  try {
    const result = await args.channel.request({
      op: EClientRequest.CaptureWorkspace,
      params: { cwd: args.cwd },
    })
    return result as WorkspaceSnapshot | null
  } catch {
    return null
  }
}

async function applyWorkspacePatch(args: {
  cwd: string
  patch: string
}): Promise<void> {
  if (args.patch.length === 0) return

  const patchPath = join(args.cwd, '.git', 'atlas-descend.patch')
  writeFileSync(patchPath, args.patch)

  const applied = await runGit({
    args: ['apply', '--whitespace=nowarn', patchPath],
    cwd: args.cwd,
  })

  unlinkSync(patchPath)

  if (!applied.ok) {
    throw new Error(`failed to apply workspace patch: ${applied.stderr || applied.stdout}`)
  }
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

  const snapshot = await captureWorkspaceFromCloud({
    channel,
    cwd: localApp.workspace.workspace,
  })
  if (snapshot?.patch !== undefined && snapshot.patch.length > 0) {
    await applyWorkspacePatch({ cwd: localApp.workspace.workspace, patch: snapshot.patch })
  }

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
    log: localApp.log,
    ids: localApp.ids,
    services: localApp.services,
    agents: localApp.agents,
  })

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

  return args.midTurn ? { ...opened.conversation, resumeOnArrival: true } : opened.conversation
}
