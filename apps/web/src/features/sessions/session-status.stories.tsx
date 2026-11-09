import { ESessionStatus } from '@dltech/atlas-core'
import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { ThreadRow } from '@/features/shell/shell-thread-row'
import { ThreadActionsContext } from '@/features/shell/thread-actions-context'
import { v2RowOf, type V2SessionSummary } from '@/features/shell/v2-rows'

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
  branch: 'dennis/v2-views-web',
  state: 'open',
  checksRunning: 2,
  checksPassed: 5,
  checksFailed: 0,
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
        shells={{ running: 0, awaitingInput: false, labels: [] }}
        crew={{ running: 0, total: 0 }}
        crewRows={[]}
        previews={[]}
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
  render: () => header({ branch: 'dennis/v2-views-web', entries: [entry()] }),
}

export const HeaderMergedPr = {
  render: () => header({ branch: 'dennis/v2-views-web', entries: [entry({ state: 'merged' })] }),
}

export const HeaderUnknownState = {
  render: () =>
    header({
      branch: 'dennis/v2-views-web',
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

const summary = (overrides: Partial<V2SessionSummary>): V2SessionSummary => ({
  sessionId: 'v2-a',
  projectId: 'p1',
  title: 'Show v2 session status',
  naming: false,
  mainThreadId: 'thr-a',
  createdAt: '2026-11-07T10:00:00.000Z',
  updatedAt: '2026-11-07T11:00:00.000Z',
  archivedAt: null,
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
              primaryBranch: 'dennis/v2-views-web',
              pullRequest: {
                repo: 'owner/atlas',
                number: 128,
                url: 'https://github.com/owner/atlas/pull/128',
                state: 'open',
                checks: { running: 2, passed: 5, failed: 0 },
              },
            }),
            summary({
              sessionId: 'v2-b',
              title: 'Fix the build',
              status: { state: ESessionStatus.StartFailed },
              primaryBranch: 'fix/build',
            }),
            summary({ sessionId: 'v2-c', title: 'No status yet' }),
          ].map((row) => (
            <ThreadRow
              key={row.sessionId}
              session={v2RowOf(row)}
              projectName="atlas"
              activeThreadId={null}
            />
          ))}
        </ul>
      </ThreadActionsContext.Provider>
    </SidebarProvider>
  ),
}
