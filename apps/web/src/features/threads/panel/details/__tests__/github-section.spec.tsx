import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { threadOf } from '@/features/shell/__tests__/fixtures'
import { currentBranchOf } from '@/features/threads/data/header-model'
import type { PullRequestsView } from '@/features/threads/data/use-pull-requests'

import { ThreadPanelProvider, type ThreadPanelValue } from '../../thread-panel-context'
import { EMPTY_DETAILS } from '../details-input'
import { GithubSection } from '../github-section'

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await GlobalRegistrator.unregister()
})

const pullRequests: PullRequestsView = {
  ...EMPTY_DETAILS.pullRequests,
  rows: [],
}

async function renderWith(thread: Parameters<typeof currentBranchOf>[0]) {
  const value: Pick<ThreadPanelValue, 'details'> = {
    details: { ...EMPTY_DETAILS, branch: currentBranchOf(thread), pullRequests },
  }
  await act(async () =>
    root.render(
      <ThreadPanelProvider value={value as ThreadPanelValue}>
        <GithubSection />
      </ThreadPanelProvider>,
    ),
  )
}

describe('right panel branch', () => {
  it('shows the observed checkout branch', async () => {
    await renderWith(
      threadOf({
        id: 't',
        worktree: { path: '/w', branch: 'old' },
        checkout: { path: '/w', branch: 'switched', detached: false },
      }),
    )
    expect(container.textContent).toContain('switched')
    expect(container.textContent).not.toContain('old')
  })

  it('renders nothing for a non-git directory', async () => {
    await renderWith(
      threadOf({
        id: 't',
        worktree: { path: '/w', branch: 'old' },
        checkout: { path: '/tmp', branch: null, detached: false },
      }),
    )
    expect(container.textContent).toBe('')
  })
})
