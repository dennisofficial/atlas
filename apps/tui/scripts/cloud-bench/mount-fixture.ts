import { activeWorktreeOf, homeDirectoryOf, projectDirectoryOf, type ThreadId } from '@dltech/atlas-core'
import type { composeHarness } from '@dltech/atlas-harness'

import { EOpenMode } from '../../src/composition/config'
import { openConversation, type OpenedConversation } from '../../src/composition/open-conversation'
import type { PluginSurface } from '../../src/plugins/surface'
import { measured, type BenchmarkRecorder } from './timing'

export type BenchmarkHarness = Awaited<ReturnType<typeof composeHarness<undefined, never, PluginSurface>>>

async function normalizeClonedThreads(args: {
  harness: BenchmarkHarness
  cwd: string
  threadIds: readonly ThreadId[]
}): Promise<void> {
  const { harness, cwd, threadIds } = args
  const repo = harness.workspace.repo
  for (const threadId of threadIds) {
    await harness.threads.adopt({ threadId, workspace: cwd, repo })
    const [event] = await harness.log.append({
      threadId,
      runId: harness.ids.nextRunId(),
      drafts: [{ type: 'directory-changed', path: cwd, repo }],
    })
    const head = await harness.log.head({ threadId })
    if (event?.type !== 'directory-changed' || event.seq !== head) {
      throw new Error('the directory reset did not land as the last event of a cloned thread')
    }
  }
}

function assertWorkspaceIsDisposable(args: { conversation: OpenedConversation; cwd: string }): void {
  const { conversation, cwd } = args
  const launchDirectory = cwd
  const resolved = projectDirectoryOf({ events: conversation.events, launchDirectory })
  const standing = activeWorktreeOf(conversation.events)
  const baseHome = conversation.base?.home ?? homeDirectoryOf({ events: conversation.events, launchDirectory })
  if (resolved !== cwd || standing !== undefined || conversation.base?.worktree !== undefined || baseHome !== cwd) {
    throw new Error('the cloned conversation still points at a directory other than the disposable workspace')
  }
}

async function openClonedRoot(args: {
  harness: BenchmarkHarness
  threadId: ThreadId
  record: BenchmarkRecorder
}): Promise<OpenedConversation> {
  const { harness, threadId, record } = args
  const outcome = await openConversation({
    threads: harness.threads,
    log: harness.log,
    ledger: harness.ledger,
    agents: harness.agents,
    shells: harness.shells,
    services: harness.services,
    ids: harness.ids,
    workspace: harness.workspace,
    open: { mode: EOpenMode.Resume, threadId },
    effects: (name) => harness.tools.find(name)?.effect,
  })
  if ('cloud' in outcome) throw new Error('the cloned conversation is marked cloud; the benchmark starts on the host')
  if (!outcome.ok) throw new Error(`the cloned conversation could not be opened: ${outcome.reason}`)

  const { conversation } = outcome
  record({
    phase: 'opened-cloned-root',
    events: conversation.events.length,
    lostAgentsSettled: conversation.lost?.settled.length ?? 0,
    lostAgentsUnlogged: conversation.lost?.unlogged.length ?? 0,
    lostShells: conversation.lostShells?.length ?? 0,
  })
  return { ...conversation, resumeOnArrival: false }
}

function forgetRecoveredNotices(args: {
  harness: BenchmarkHarness
  threadIds: readonly ThreadId[]
  record: BenchmarkRecorder
}): void {
  const { harness, record } = args
  let pending = 0
  for (const threadId of args.threadIds) {
    pending +=
      harness.agents.pendingNotices({ threadId }).length +
      harness.shells.pendingNotices({ threadId }).length +
      harness.services.pendingNotices({ threadId }).length
    harness.agents.forgetNotices({ threadId })
    harness.shells.forgetNotices({ threadId })
    harness.services.forgetNotices({ threadId })
  }
  record({ phase: 'recovered-notices-forgotten', pending })
}

export async function openNormalizedRoot(args: {
  harness: BenchmarkHarness
  cwd: string
  threadId: ThreadId
  threadIds: readonly ThreadId[]
  record: BenchmarkRecorder
}): Promise<OpenedConversation> {
  const { harness, cwd, threadIds, record } = args
  await measured({
    name: 'normalize-cloned-threads',
    record,
    run: () => normalizeClonedThreads({ harness, cwd, threadIds }),
  })
  record({ phase: 'fixture-normalized', threads: threadIds.length })

  const opened = await openClonedRoot({ harness, threadId: args.threadId, record })
  assertWorkspaceIsDisposable({ conversation: opened, cwd })
  forgetRecoveredNotices({ harness, threadIds, record })
  return opened
}
