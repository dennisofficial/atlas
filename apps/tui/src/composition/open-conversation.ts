import {
  EExecutionLocation,
  projectOf,
  toThreadId,
  type IdPort,
  type ThreadId,
  type Event,
  type EventLogPort,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'
import type {
  AgentRegistryPort,
  RecoveredAgents,
  ThreadModel,
  ThreadStorePort,
  ThreadSummary,
  TurnLedgerPort,
  TurnSpend,
} from '@dltech/atlas-harness'
import type { LostShell, ServiceRegistryPort, ShellRegistryPort } from '@dltech/atlas-harness'

import { EOpenMode, type OpenRequest } from './config'
import { claimThread, closeConversation, recoverLostProcesses } from './conversation-claim'
import { readThreadSpend } from './thread-spend'
import { readThreadSnapshot, type ThreadIdentity } from './thread-reads'
import { EThreadRows } from './use-thread-view'
import type { LogAccumulator, ToolEffects } from '../store/log-accumulator'
import { titleMatchesHandle, transcriptIdentityDigest } from '@dltech/atlas-harness'

export type OpenedConversation = {
  threadId: ThreadId
  events: readonly Event[]
  turns: readonly TurnSpend[]
  name: string | null
  started: boolean
  model?: ThreadModel | undefined
  executionLocation?: EExecutionLocation | undefined
  lost?: RecoveredAgents | undefined
  lostShells?: readonly LostShell[] | undefined
  base?: LogAccumulator | undefined
  bootCloudThreadId?: ThreadId | undefined
  resumeOnArrival?: boolean | undefined
  identity?: ThreadIdentity | undefined
}

export { closeConversation }

export const unstartedConversation = (args: {
  ids: IdPort
  bootCloudThreadId?: ThreadId | undefined
}): OpenedConversation => ({
  threadId: args.ids.nextThreadId(),
  events: [],
  turns: [],
  name: null,
  started: false,
  ...(args.bootCloudThreadId === undefined ? {} : { bootCloudThreadId: args.bootCloudThreadId }),
})

/**
 * The thread meta's executionLocation is the pointer to where the transcript lives: a thread that
 * points at the cloud is never opened as a local conversation, because the local open claims the
 * session lock and reads a local transcript the sandbox already owns. The caller routes the cloud
 * variant through the attach flow instead.
 */
export type CloudThreadOutcome = { cloud: true; threadId: ThreadId }

export type OpenOutcome =
  | { ok: true; conversation: OpenedConversation }
  | { ok: false; reason: string }
  | CloudThreadOutcome

type Opening = {
  threads: ThreadStorePort
  remoteThreads?: ThreadStorePort | undefined
  log: EventLogPort
  ledger: TurnLedgerPort
  agents: AgentRegistryPort
  ids: IdPort
  workspace: WorkspaceIdentity
  open: OpenRequest
  effects: ToolEffects
  shells?: ShellRegistryPort | undefined
  services?: ServiceRegistryPort | undefined
  preparing?: boolean | undefined
}

const unknownThread = (args: { threadId: string; project: string }): string =>
  `no conversation "${args.threadId}" has been opened in ${args.project}`

/**
 * A thread with no workspace of its own predates the attribution and belongs to whoever asks for it
 * by id; one attributed elsewhere in this project (the main checkout or any of its worktrees) is
 * resumable from anywhere in it. One attributed to another project stays where it is.
 */
const reachableFrom = (args: { thread: ThreadSummary; project: string }): boolean =>
  args.thread.workspace === null ||
  args.thread.workspace === args.project ||
  args.thread.repo === args.project

export const namedBy = (args: { thread: ThreadSummary; handle: string }): boolean =>
  args.thread.title !== undefined &&
  titleMatchesHandle({ title: args.thread.title, handle: args.handle })

async function resumed(args: Opening & { handle: string }): Promise<ThreadSummary | undefined> {
  const { handle, threads, workspace } = args
  const project = projectOf(workspace)

  const byId = await threads.find({ threadId: toThreadId(handle) })
  if (byId !== undefined && reachableFrom({ thread: byId, project })) {
    if (byId.workspace === null && args.preparing !== true) {
      await threads.adopt({
        threadId: byId.id,
        workspace: workspace.workspace,
        repo: workspace.repo,
      })
    }

    return byId
  }

  const named = await threads.findNamed({ project, handle })
  if (named !== undefined) return named

  const remote = args.remoteThreads
  if (remote === undefined) return undefined

  const remoteById = await remote.find({ threadId: toThreadId(handle) }).catch(() => undefined)
  if (remoteById !== undefined && reachableFrom({ thread: remoteById, project })) {
    return remoteById
  }

  return remote.findNamed({ project, handle }).catch(() => undefined)
}

type Found = ThreadSummary | { unstarted: true } | { reason: string }

async function threadFor(args: Opening): Promise<Found> {
  const { threads, workspace } = args
  const project = projectOf(workspace)
  const unstarted = { unstarted: true } as const

  if (args.open.mode === EOpenMode.New) return unstarted

  if (args.open.mode === EOpenMode.Continue) {
    return (await threads.mostRecent({ project })) ?? unstarted
  }

  const { threadId } = args.open
  const found = await resumed({ ...args, handle: threadId })
  if (found === undefined) {
    return { reason: unknownThread({ threadId, project }) }
  }

  return found
}

async function readOpenedConversation(args: {
  thread: ThreadSummary
  log: EventLogPort
  ledger: TurnLedgerPort
  effects: ToolEffects
  lost?: RecoveredAgents | undefined
  lostShells?: readonly LostShell[] | undefined
}): Promise<OpenedConversation> {
  const { thread } = args
  // The window, the base and the transcript identity derive from one immutable full read — an
  // append or rewind landing between separate reads would have them describe different
  // transcripts, and the identity is what later freshness decisions trust as the applied truth.
  const snapshot = await readThreadSnapshot({
    log: args.log,
    threadId: thread.id,
    rows: EThreadRows.Composed,
    effects: args.effects,
    digest: transcriptIdentityDigest,
  })
  const spent = await readThreadSpend({ ledger: args.ledger, threadId: thread.id })

  return {
    threadId: thread.id,
    events: snapshot.events,
    turns: spent.turns,
    name: thread.title ?? null,
    started: true,
    model: thread.model,
    executionLocation: thread.executionLocation,
    lost: args.lost,
    lostShells: args.lostShells,
    base: snapshot.base,
    identity: snapshot.identity,
  }
}

/**
 * The order is the invariant. Children the last process lost are settled before the transcript is
 * read, so the endings it writes are in the events the screen is built from rather than a turn
 * behind them; settling twice is safe, so an operator returning to a conversation costs nothing.
 */
export async function openConversation(args: Opening): Promise<OpenOutcome> {
  const thread = await threadFor(args)
  if ('reason' in thread) return { ok: false, reason: thread.reason }
  if ('unstarted' in thread) {
    await closeConversation()
    return { ok: true, conversation: unstartedConversation({ ids: args.ids }) }
  }

  if (args.preparing === true) {
    return {
      ok: true,
      conversation: await readOpenedConversation({
        thread,
        log: args.log,
        ledger: args.ledger,
        effects: args.effects,
      }),
    }
  }

  if (thread.executionLocation === EExecutionLocation.Cloud) {
    return { cloud: true, threadId: thread.id }
  }

  const refusal = await claimThread({ threadId: thread.id })
  if (refusal !== null) return { ok: false, reason: refusal }

  const lost = await args.agents.recordLostAgents({ threadId: thread.id })
  const lostShells = await recoverLostProcesses({
    threadId: thread.id,
    log: args.log,
    ids: args.ids,
    shells: args.shells,
    services: args.services,
  })

  return {
    ok: true,
    conversation: await readOpenedConversation({ thread, log: args.log, ledger: args.ledger, effects: args.effects, lost, lostShells }),
  }
}
