import {
  EExecutionLocation,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'
import { relocateSession } from '@dltech/atlas-harness'

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

const sameDraft = (left: EventDraft, right: EventDraft): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export type DescendLocalHome = Pick<
  AtlasApp,
  'threads' | 'log' | 'ledger' | 'agents' | 'ids' | 'workspace' | 'services'
>

/**
 * The descend's transfer trusts seq alignment between the two logs: the lift replayed the local
 * log into the remote one in order, so the first local.head remote events are the ones the local
 * store already has. Logs are append-only on both sides, so a mismatch at the boundary means the
 * histories diverged and appending a tail would silently fork the transcript.
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

  const head = await localApp.log.head({ threadId })
  if (head > events.length) {
    throw new Error('the local log holds events the cloud never saw')
  }
  if (head > 0) {
    const boundaryLocal = (await localApp.log.read({ threadId, upTo: head })).at(-1)
    const boundaryRemote = events.at(head - 1)
    if (boundaryLocal === undefined || boundaryRemote === undefined) {
      throw new Error('the local log diverged from the cloud while the conversation was away')
    }
    const [localDraft] = draftsOf([boundaryLocal])
    const [remoteDraft] = draftsOf([boundaryRemote])
    if (
      localDraft === undefined ||
      remoteDraft === undefined ||
      !sameDraft(localDraft, remoteDraft)
    ) {
      throw new Error('the local log diverged from the cloud while the conversation was away')
    }
  }

  const tail = events.slice(head)
  if (tail.length === 0) return
  await localApp.log.append({
    threadId,
    runId: localApp.ids.nextRunId(),
    drafts: draftsOf(tail),
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
