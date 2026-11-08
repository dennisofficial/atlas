import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { SubscribedPullRequest } from '@dltech/atlas-plugin-github/client'
import type { ShellRoster } from '@dltech/atlas-plugin-shells/client'
import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { EHeaderState } from '@/features/threads/data/header-model'
import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import { SessionHeader } from '../session-header'

const entry = (overrides: Partial<PullRequestEntry> = {}): PullRequestEntry => ({
  repo: 'owner/atlas',
  number: 12,
  url: 'https://github.com/owner/atlas/pull/12',
  branch: 'topic',
  state: 'open',
  checksRunning: 2,
  checksPassed: 3,
  checksFailed: 0,
  mergeable: true,
  current: true,
  via: undefined,
  ...overrides,
})

const subscribed: SubscribedPullRequest = {
  number: 31,
  label: 'owner/atlas#31',
  url: 'https://github.com/owner/atlas/pull/31',
}

const render = (props: {
  branch?: string
  entries: PullRequestEntry[]
  subscriptions?: SubscribedPullRequest[]
  shells?: ShellRoster
}) =>
  renderToStaticMarkup(
    <SidebarProvider>
      <SessionHeader
        sessionId="s1"
        state={EHeaderState.Idle}
        title="Fix login"
        naming={false}
        branch={props.branch}
        entries={props.entries}
        subscriptions={props.subscriptions ?? []}
        shells={props.shells ?? { running: 0, awaitingInput: false, labels: [] }}
      />
    </SidebarProvider>,
  )

describe('SessionHeader', () => {
  it('shows the branch and an open pull request with running checks linking to its url', () => {
    const html = render({ branch: 'topic', entries: [entry()] })
    expect(html).toContain('data-session-branch')
    expect(html).toContain('topic')
    expect(html).toContain('href="https://github.com/owner/atlas/pull/12"')
    expect(html).toContain('#12')
    expect(html).toContain('aria-label="Pull request open"')
    expect(html).toContain('2 running, 3 passed, 0 failed')
  })

  it('shows a merged pull request without checks', () => {
    const html = render({ entries: [entry({ state: 'merged' })] })
    expect(html).toContain('aria-label="Pull request merged"')
    expect(html).not.toContain('running,')
  })

  it('shows unknown state as unknown, without guessing', () => {
    const html = render({
      entries: [
        entry({
          state: undefined,
          checksRunning: undefined,
          checksPassed: undefined,
          checksFailed: undefined,
          mergeable: undefined,
        }),
      ],
    })
    expect(html).toContain('state unknown')
    expect(html).toContain('Checks unknown')
    expect(html).not.toContain('Merge conflicts')
  })

  it('shows neither branch nor pull request when the view has none', () => {
    const html = render({ entries: [] })
    expect(html).not.toContain('data-session-branch')
    expect(html).not.toContain('data-session-pr')
  })

  it('lists the pull requests the session is subscribed to, each linking to its url', () => {
    const html = render({ entries: [], subscriptions: [subscribed] })
    expect(html).toContain('data-session-subscriptions')
    expect(html).toContain('href="https://github.com/owner/atlas/pull/31"')
    expect(html).toContain('#31')
  })

  it('shows no subscription indicator without subscriptions', () => {
    expect(render({ entries: [entry()] })).not.toContain('data-session-subscriptions')
  })

  it('shows the running shell count titled with their labels', () => {
    const html = render({
      entries: [],
      shells: { running: 2, awaitingInput: false, labels: ['dev server', 'watcher'] },
    })
    expect(html).toContain('data-session-shells')
    expect(html).toContain('title="dev server, watcher"')
    expect(html).toContain('>2<')
  })

  it('shows no shell indicator when none are running', () => {
    expect(render({ entries: [entry()] })).not.toContain('data-session-shells')
  })
})
