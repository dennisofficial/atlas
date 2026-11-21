import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { ESubscriptionActor, ESubscriptionTone } from '@dltech/atlas-core'
import type { CrewRow } from '@dltech/atlas-plugin-crew/client'
import type { SubscriptionListRow } from '@dltech/atlas-plugin-github/client'
import type { PreviewItem } from '@dltech/atlas-plugin-services/client'
import type { ShellRoster } from '@dltech/atlas-plugin-shells/client'
import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { EHeaderState } from '@/features/threads/data/header-model'
import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import { CrewPanel } from '../crew-panel'
import { PreviewLinks, SessionHeader } from '../session-header'
import { ShellTails } from '../shell-tails'

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

const subscriptionRow = (overrides: Partial<SubscriptionListRow> = {}): SubscriptionListRow => ({
  id: 'sub_31',
  provider: 'github.pull-request',
  createdBy: ESubscriptionActor.Agent,
  threadId: 't1',
  number: 31,
  held: 0,
  presentation: {
    icon: 'git-pull-request',
    tone: ESubscriptionTone.Open,
    title: '#31 Follow it',
    meta: ['Pull request', 'all events'],
  },
  ...overrides,
})

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

type HeaderProps = {
  branch?: string
  routineId?: string | null
  entries: PullRequestEntry[]
  subscriptions?: SubscriptionListRow[]
  shells?: ShellRoster
  shellTails?: Readonly<Record<string, string>>
  crewRows?: readonly CrewRow[]
  previews?: readonly PreviewItem[]
  paneCollapsed?: boolean
  onTogglePane?: () => void
  onOpenPane?: () => void
  onOpenDetails?: () => void
  onOpenPreview?: (url: string) => void
}

const headerOf = (props: HeaderProps) => (
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
      paneCollapsed={props.paneCollapsed}
      onTogglePane={props.onTogglePane}
      onOpenPane={props.onOpenPane}
      onOpenDetails={props.onOpenDetails}
      onOpenPreview={props.onOpenPreview ?? (() => undefined)}
    />
  </SidebarProvider>
)

const render = (props: HeaderProps) => renderToStaticMarkup(headerOf(props))

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

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

  it('shows a closed pull request as closed, without checks or a conflict warning', () => {
    const html = render({
      entries: [
        entry({
          state: 'closed',
          mergeable: false,
          checksRunning: 0,
          checksPassed: 1,
          checksFailed: 0,
        }),
      ],
    })
    expect(html).toContain('aria-label="Pull request closed"')
    expect(html).toContain('#12')
    expect(html).not.toContain('passed')
    expect(html).not.toContain('Merge conflicts')
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

  it('does not tag a v2 session', () => {
    const html = render({ entries: [] })
    expect(html).not.toContain('>v2<')
    expect(html).not.toContain('data-engine-tag')
  })

  it('does not tag a v2 session', () => {
    const html = render({ entries: [] })
    expect(html).not.toContain('>v2<')
    expect(html).not.toContain('data-engine-tag')
  })

  it('shows neither branch nor pull request when the view has none', () => {
    const html = render({ entries: [] })
    expect(html).not.toContain('data-session-branch')
    expect(html).not.toContain('data-session-pr')
  })

  it('counts every active subscription behind a bell', () => {
    const html = render({
      entries: [],
      subscriptions: [
        subscriptionRow(),
        subscriptionRow({ id: 'sub_32', provider: 'github.workflow-run', number: undefined }),
      ],
    })
    expect(html).toContain('data-session-subscriptions')
    expect(html).toContain('aria-label="2 subscriptions"')
    expect(html).toContain('title="2 subscriptions"')
    expect(html).toContain('>2<')
  })

  it('shows no subscription indicator without a subscription', () => {
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

  it('offers a pane toggle that reports whether the pane is collapsed', () => {
    const expanded = render({ entries: [], paneCollapsed: false })
    expect(expanded).toContain('aria-label="Collapse panel"')
    expect(expanded).toContain('aria-expanded="true"')
    const collapsed = render({ entries: [], paneCollapsed: true })
    expect(collapsed).toContain('aria-label="Expand panel"')
    expect(collapsed).toContain('aria-expanded="false"')
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
  it('opens each preview in the pane, labelled, ported and titled with its url', () => {
    const html = renderToStaticMarkup(
      <PreviewLinks previews={[preview()]} onOpenPreview={() => undefined} />,
    )
    expect(html).toContain('<button type="button"')
    expect(html).toContain('title="https://4321-abc.byatlas.dev"')
    expect(html).toContain('>web<')
    expect(html).toContain(':4321')
    expect(html).not.toContain('target="_blank"')
  })

  it('hands the preview url of the clicked chip to the pane', () => {
    const opened: string[] = []
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() =>
      root.render(
        <PreviewLinks
          previews={[preview()]}
          onOpenPreview={(url) => {
            opened.push(url)
          }}
        />,
      ),
    )
    const chip = container.querySelector('button')
    if (chip === null) throw new Error('the chip is not a button')
    act(() => chip.click())
    act(() => root.unmount())
    expect(opened).toEqual(['https://4321-abc.byatlas.dev'])
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
