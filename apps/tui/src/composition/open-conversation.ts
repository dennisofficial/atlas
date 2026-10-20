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
  ThreadModel,
  ThreadStorePort,
  ThreadSummary,
  TurnLedgerPort,
  TurnSpend,
} from '@dltech/atlas-harness'

import { EOpenMode, type OpenRequest } from './config'
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
  base?: LogAccumulator | undefined
  bootCloudThreadId?: ThreadId | undefined
  /** The transcript opened from the local mirror; the sandbox attach is the workspace's first act. */
  attachOnBoot?: boolean | undefined
  resumeOnArrival?: boolean | undefined
  identity?: ThreadIdentity | undefined
  appliedEvents?: readonly Event[] | undefined
}

export const unstartedConversation = (args: {
  ids: IdPort
  bootCloudThreadId?: ThreadId | undefined
  threadId?: ThreadId | undefined
}): OpenedConversation => ({
  threadId: args.threadId ?? args.ids.nextThreadId(),
  events: [],
  turns: [],
  name: null,
  started: false,
  ...(args.bootCloudThreadId === undefined ? {} : { bootCloudThreadId: args.bootCloudThreadId }),
})

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
  ids: IdPort
  workspace: WorkspaceIdentity
  open: OpenRequest
  effects: ToolEffects
  preparing?: boolean | undefined
  /** Boot is the only caller that may open a cloud thread's transcript directly. */
  boot?: boolean | undefined
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
    base: snapshot.base,
    identity: snapshot.identity,
  }
}

export async function openConversation(args: Opening): Promise<OpenOutcome> {
  const thread = await threadFor(args)
  if ('reason' in thread) return { ok: false, reason: thread.reason }
  if ('unstarted' in thread) {
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
    if (args.boot !== true) {
      return { cloud: true, threadId: thread.id }
    }
    // A boot resume opens the mirrored transcript at once and hands the workspace the attach as
    // its first act — mounting an unstarted placeholder instead would leave the welcome hero up
    // for the whole wake, and forever if the attach fails.
    return {
      ok: true,
      conversation: {
        ...(await readOpenedConversation({ thread, log: args.log, ledger: args.ledger, effects: args.effects })),
        attachOnBoot: true,
      },
    }
  }

  return { ok: false, reason: unknownThread({ threadId: thread.id, project: projectOf(args.workspace) }) }
}
