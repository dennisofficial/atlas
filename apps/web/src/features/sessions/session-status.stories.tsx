import { ESessionStatus } from '@dltech/atlas-core'
import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { ThreadRow } from '@/features/shell/shell-thread-row'
import { ThreadActionsContext } from '@/features/shell/thread-actions-context'
import type { SessionSummary } from '@dltech/atlas-protocol'
import { rowOf } from '@/features/shell/session-rows'

import { SessionHeader } from './session-header'
import { StartFailedCard } from './start-failed-card'
import { EHeaderState } from '@/features/threads/data/header-model'
import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

const meta = {
  title: 'Sessions/Session status',
  parameters: { layout: 'fullscreen' },
}

export default meta

const entry = (overrides: Partial<PullRequestEntry> = {}): PullRequestEntry => ({
  repo: 'owner/atlas',
  number: 128,
  url: 'https://github.com/owner/atlas/pull/128',
  branch: 'dennis/session-views',
  state: 'open',
  checksRunning: 2,
  checksPassed: 5,
  checksFailed: 0,
  checksExpected: 0,
  checksState: undefined,
  mergeable: true,
  current: true,
  via: undefined,
  ...overrides,
})

const header = (args: { entries: PullRequestEntry[]; branch: string | undefined }) => (
  <SidebarProvider>
    <div className="w-full">
      <SessionHeader
        sessionId="story"
        state={EHeaderState.Idle}
        title="Show v2 session status"
        naming={false}
        branch={args.branch}
        entries={args.entries}
        subscriptions={[]}
        shells={{ running: 0, awaitingInput: false, labels: [], rows: [] }}
        shellTails={{}}
        crew={{ running: 0, total: 0 }}
        crewRows={[]}
        previews={[]}
        onOpenPreview={() => undefined}
      />
    </div>
  </SidebarProvider>
)

export const StartFailed = {
  render: () => (
    <div className="mx-auto w-full max-w-3xl p-4">
      <StartFailedCard
        reason="No sandbox capacity in this region"
        onRetry={() => new Promise((r) => setTimeout(r, 1500))}
      />
    </div>
  ),
}

export const HeaderOpenPrChecksRunning = {
  render: () => header({ branch: 'dennis/session-views', entries: [entry()] }),
}

export const HeaderMergedPr = {
  render: () => header({ branch: 'dennis/session-views', entries: [entry({ state: 'merged' })] }),
}

export const HeaderClosedPr = {
  render: () =>
    header({
      branch: 'dennis/session-views',
      entries: [
        entry({
          state: 'closed',
          checksRunning: 0,
          checksPassed: 1,
          checksFailed: 0,
          mergeable: false,
        }),
      ],
    }),
}

export const HeaderUnknownState = {
  render: () =>
    header({
      branch: 'dennis/session-views',
      entries: [
        entry({
          state: undefined,
          checksRunning: undefined,
          checksPassed: undefined,
          checksFailed: undefined,
          mergeable: undefined,
        }),
      ],
    }),
}

const summary = (overrides: Partial<SessionSummary>): SessionSummary => ({
  sessionId: 'ses-a',
  projectId: 'p1',
  title: 'Show v2 session status',
  naming: false,
  mainThreadId: 'thr-a',
  createdAt: '2026-11-07T10:00:00.000Z',
  updatedAt: '2026-11-07T11:00:00.000Z',
  archivedAt: null,
  model: { ref: 'anthropic/claude-haiku-4-5', effort: 'medium', fast: false },
  ...overrides,
})

export const SidebarRows = {
  render: () => (
    <SidebarProvider>
      <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
        <ul className="w-72 list-none p-2">
          {[
            summary({
              status: { state: ESessionStatus.Thinking },
              primaryBranch: 'dennis/session-views',
              pullRequest: {
                repo: 'owner/atlas',
                number: 128,
                url: 'https://github.com/owner/atlas/pull/128',
                state: 'open',
                checks: { running: 2, passed: 5, failed: 0 },
                mergeable: false,
              },
            }),
            summary({
              sessionId: 'ses-b',
              title: 'Fix the build',
              status: { state: ESessionStatus.StartFailed },
              primaryBranch: 'fix/build',
            }),
            summary({ sessionId: 'ses-c', title: 'No status yet' }),
          ].map((row) => (
            <ThreadRow
              key={row.sessionId}
              session={rowOf(row)}
              projectName="atlas"
              activeThreadId={null}
            />
          ))}
        </ul>
      </ThreadActionsContext.Provider>
    </SidebarProvider>
  ),
}
