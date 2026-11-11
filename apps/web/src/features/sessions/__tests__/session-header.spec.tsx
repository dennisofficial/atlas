import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { CrewRow } from '@dltech/atlas-plugin-crew/client'
import type { SubscribedPullRequest } from '@dltech/atlas-plugin-github/client'
import type { PreviewItem } from '@dltech/atlas-plugin-services/client'
import type { ShellRoster } from '@dltech/atlas-plugin-shells/client'
import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { EHeaderState } from '@/features/threads/data/header-model'
import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import { CrewPanel } from '../crew-panel'
import { PreviewLinks, SessionHeader, ShellTails } from '../session-header'

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

const preview = (overrides: Partial<PreviewItem> = {}): PreviewItem => ({
  serviceId: 'svc1',
  label: 'web',
  port: 4321,
  url: 'https://4321-abc.byatlas.dev',
  ...overrides,
})

const crewRow = (overrides: Partial<CrewRow> = {}): CrewRow => ({
  agentId: 'a1',
  agentType: 'general-purpose',
  intent: 'work the branch',
  status: 'running',
  turns: 1,
  toolCalls: 2,
  startedAt: '2026-11-09T10:00:00.000Z',
  ...overrides,
})

const render = (props: {
  branch?: string
  routineId?: string | null
  entries: PullRequestEntry[]
  subscriptions?: SubscribedPullRequest[]
  shells?: ShellRoster
  shellTails?: Readonly<Record<string, string>>
  crewRows?: readonly CrewRow[]
  previews?: readonly PreviewItem[]
}) =>
  renderToStaticMarkup(
    <SidebarProvider>
      <SessionHeader
        sessionId="s1"
        state={EHeaderState.Idle}
        routineId={props.routineId ?? null}
        title="Fix login"
        naming={false}
        branch={props.branch}
        entries={props.entries}
        subscriptions={props.subscriptions ?? []}
        shells={props.shells ?? { running: 0, awaitingInput: false, labels: [], rows: [] }}
        shellTails={props.shellTails ?? {}}
        crew={{
          running: (props.crewRows ?? []).filter((row) => row.status === 'running').length,
          total: (props.crewRows ?? []).length,
        }}
        crewRows={props.crewRows ?? []}
        previews={props.previews ?? []}
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
      shells: {
        running: 2,
        awaitingInput: false,
        labels: ['dev server', 'watcher'],
        rows: [
          { shellId: 'sh1', name: 'dev server' },
          { shellId: 'sh2', name: 'watcher' },
        ],
      },
    })
    expect(html).toContain('data-session-shells')
    expect(html).toContain('title="dev server, watcher"')
    expect(html).toContain('>2<')
  })

  it('shows no shell indicator when none are running', () => {
    expect(render({ entries: [entry()] })).not.toContain('data-session-shells')
  })

  it('shows the preview count titled with their labels and ports', () => {
    const html = render({
      entries: [],
      previews: [preview(), preview({ serviceId: 'svc2', label: 'api', port: 5000 })],
    })
    expect(html).toContain('data-session-previews')
    expect(html).toContain('title="web:4321, api:5000"')
    expect(html).toContain('>2<')
  })

  it('shows no preview indicator when nothing is published', () => {
    expect(render({ entries: [entry()] })).not.toContain('data-session-previews')
  })

  it('counts the sub-agents and names them in the crew chip', () => {
    const html = render({
      entries: [entry()],
      crewRows: [
        crewRow(),
        crewRow({
          agentId: 'a2',
          agentType: 'explore',
          intent: 'map the plugin seam',
          status: 'finished',
        }),
      ],
    })

    expect(html).toContain('data-session-crew')
    expect(html).toContain('aria-label="2 sub-agents, 1 running"')
    expect(html).toContain('title="general-purpose: work the branch, explore: map the plugin seam"')
    expect(html).toContain('>1/2<')
  })

  it('shows no crew indicator when no sub-agent ran', () => {
    expect(render({ entries: [entry()] })).not.toContain('data-session-crew')
  })

  it('tags a session a routine produced, and leaves an ordinary session untagged', () => {
    expect(render({ entries: [], routineId: 'rte-1' })).toContain('data-session-routine')
    expect(render({ entries: [] })).not.toContain('data-session-routine')
  })
})

describe('CrewPanel', () => {
  it('names each sub-agent, its standing, its worktree and its last words', () => {
    const html = renderToStaticMarkup(
      <CrewPanel
        rows={[
          crewRow({
            prose: 'Committed and pushed.',
            worktree: { path: '/work/.atlas/worktrees/dennis/wt', branch: 'dennis/wt' },
          }),
        ]}
      />,
    )

    expect(html).toContain('data-crew-row')
    expect(html).toContain('general-purpose')
    expect(html).toContain('work the branch')
    expect(html).toContain('running')
    expect(html).toContain('dennis/wt')
    expect(html).toContain('/work/.atlas/worktrees/dennis/wt')
    expect(html).toContain('Committed and pushed.')
    expect(html).toContain('1 turn · 2 tools')
  })
})

describe('PreviewLinks', () => {
  it('links each preview to its public url, labelled and ported', () => {
    const html = renderToStaticMarkup(<PreviewLinks previews={[preview()]} />)
    expect(html).toContain('href="https://4321-abc.byatlas.dev"')
    expect(html).toContain('title="https://4321-abc.byatlas.dev"')
    expect(html).toContain('>web<')
    expect(html).toContain(':4321')
  })
})

describe('ShellTails', () => {
  const shells = {
    running: 1,
    awaitingInput: false,
    labels: ['"ticker" (`while true; do date; sleep 1; done`)'],
    rows: [{ shellId: 'shell-1', name: '"ticker" (`while true; do date; sleep 1; done`)' }],
  }

  it('shows the tail streamed for a running shell', () => {
    const html = renderToStaticMarkup(
      <ShellTails shells={shells} tails={{ 'shell-1': 'tick 1\ntick 2\n' }} />,
    )

    expect(html).toContain('data-shell-tail="shell-1"')
    expect(html).toContain('tick 1')
    expect(html).toContain('tick 2')
  })

  it('says so when nothing has been streamed yet', () => {
    const html = renderToStaticMarkup(<ShellTails shells={shells} tails={{}} />)

    expect(html).toContain('No output yet')
    expect(html).not.toContain('data-shell-tail=')
  })
})
