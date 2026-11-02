import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { threadOf } from '@/features/shell/__tests__/fixtures'
import type { WireThread } from '@dltech/atlas-wire/web'
import { pullRequestRowOf } from '@/features/threads/data/pull-request-rows'
import { sessionCheckoutsOf } from '@/features/threads/data/session-checkouts'
import { pullRequestEntriesOf } from '@/features/threads/data/pull-request-entries'
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

const link = (
  number: number,
  branch: string,
  via?: WireThread['pullRequests'] extends (infer T)[] | undefined
    ? T extends { via?: infer V }
      ? V
      : never
    : never,
) => ({
  number,
  url: `https://github.com/o/r/pull/${number}`,
  repo: 'o/r',
  branch,
  state: 'open',
  ...(via === undefined ? {} : { via }),
})

async function renderWith(args: { thread: WireThread; family?: WireThread[] }) {
  const entries = pullRequestEntriesOf({ thread: args.thread, states: [] })
  const rows = entries.map(pullRequestRowOf)
  const grouped = sessionCheckoutsOf({
    thread: args.thread,
    family: args.family ?? [],
    entries,
  })
  const view: PullRequestsView = {
    ...EMPTY_DETAILS.pullRequests,
    rows,
    ...grouped,
  }
  const value: Pick<ThreadPanelValue, 'details'> = {
    details: { ...EMPTY_DETAILS, pullRequests: view },
  }
  await act(async () =>
    root.render(
      <ThreadPanelProvider value={value as ThreadPanelValue}>
        <GithubSection />
      </ThreadPanelProvider>,
    ),
  )
}

const branchRows = () => container.querySelectorAll('.font-mono.truncate')

describe('right panel branch', () => {
  it('shows the observed checkout branch', async () => {
    await renderWith({
      thread: threadOf({
        id: 't',
        worktree: { path: '/w', branch: 'old' },
        checkout: { path: '/w', branch: 'switched', detached: false },
      }),
    })
    expect(container.textContent).toContain('switched')
    expect(container.textContent).not.toContain('old')
  })

  it('renders nothing for a non-git directory', async () => {
    await renderWith({
      thread: threadOf({
        id: 't',
        worktree: { path: '/w', branch: 'old' },
        checkout: { path: '/tmp', branch: null, detached: false },
      }),
    })
    expect(container.textContent).toBe('')
  })

  it('renders a single checkout with its pull request and no group label or path', async () => {
    await renderWith({
      thread: threadOf({
        id: 'm',
        worktree: { path: '/w/main', branch: 'main-b' },
        pullRequests: [link(1, 'main-b')],
      }),
    })
    expect(branchRows().length).toBe(1)
    expect(container.textContent).toContain('#1')
    expect(container.textContent).not.toContain('/w/main')
  })

  it('groups pull requests under each checkout of main and a sub-agent', async () => {
    const main = threadOf({
      id: 'm',
      title: 'Main work',
      worktree: { path: '/w/main', branch: 'main-b' },
      pullRequests: [link(1, 'main-b'), link(2, 'sub-b', { threadId: 's', title: 'Fix it' })],
    })
    const sub = threadOf({
      id: 's',
      title: 'Fix it',
      worktree: { path: '/w/sub', branch: 'sub-b' },
      pullRequests: [link(2, 'sub-b')],
    })
    await renderWith({ thread: main, family: [sub] })
    const text = container.textContent ?? ''
    expect(branchRows().length).toBe(2)
    expect(text.indexOf('main-b')).toBeLessThan(text.indexOf('sub-b'))
    expect(text.indexOf('#1')).toBeLessThan(text.indexOf('sub-b'))
    expect(text.indexOf('sub-b')).toBeLessThan(text.indexOf('#2'))
    expect(text).toContain('Fix it')
    expect(text).toContain('/w/sub')
  })

  it('merges threads on the same checkout into one group', async () => {
    const main = threadOf({
      id: 'm',
      worktree: { path: '/w', branch: 'shared' },
    })
    const mate = threadOf({
      id: 's',
      title: 'Mate',
      worktree: { path: '/w', branch: 'shared' },
    })
    await renderWith({ thread: main, family: [mate] })
    expect(branchRows().length).toBe(1)
    expect(container.textContent).not.toContain('Mate')
  })
})
