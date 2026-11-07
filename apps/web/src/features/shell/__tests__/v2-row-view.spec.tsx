import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ESessionStatus } from '@dltech/atlas-core'
import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { ThreadRow } from '../shell-thread-row'
import { ThreadActionsContext } from '../thread-actions-context'
import { v2RowOf, type V2SessionSummary } from '../v2-rows'
import { agoIso } from './fixtures'

const summary = (overrides: Partial<V2SessionSummary> = {}): V2SessionSummary => ({
  sessionId: 'v2-a',
  projectId: 'p1',
  title: 'Fix login',
  naming: false,
  mainThreadId: 'thr-a',
  createdAt: agoIso(5),
  updatedAt: agoIso(2),
  archivedAt: null,
  ...overrides,
})

const render = (overrides: Partial<V2SessionSummary>) =>
  renderToStaticMarkup(
    <SidebarProvider>
      <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
        <ThreadRow
          session={v2RowOf(summary(overrides))}
          projectName="atlas"
          activeThreadId={null}
        />
      </ThreadActionsContext.Provider>
    </SidebarProvider>,
  )

describe('v2 sidebar row', () => {
  it('shows no status icon when the row carries no status', () => {
    const html = render({})
    expect(html).not.toContain('aria-label="Idle"')
    expect(html).not.toContain('aria-label="Failed"')
  })

  it('shows the status icon from the row status', () => {
    expect(render({ status: { state: ESessionStatus.StartFailed } })).toContain(
      'aria-label="Failed"',
    )
    expect(render({ status: { state: ESessionStatus.Idle } })).toContain('aria-label="Idle"')
  })

  it('shows the primary branch, or nothing when the view states none', () => {
    expect(render({ primaryBranch: 'topic' })).toContain('topic')
    expect(render({})).not.toContain('No branch yet')
  })

  it('shows the pull request with its checks, or checks unknown', () => {
    const html = render({
      pullRequest: {
        repo: 'owner/atlas',
        number: 9,
        url: 'https://github.com/owner/atlas/pull/9',
        state: 'open',
        checks: { running: 1, passed: 2, failed: 0 },
      },
    })
    expect(html).toContain('#9')
    expect(html).toContain('1 running, 2 passed, 0 failed')
    const unknown = render({
      pullRequest: {
        repo: 'owner/atlas',
        number: 9,
        url: 'https://github.com/owner/atlas/pull/9',
        state: null,
        checks: null,
      },
    })
    expect(unknown).toContain('Checks unknown')
    expect(unknown).toContain('state unknown')
  })
})
