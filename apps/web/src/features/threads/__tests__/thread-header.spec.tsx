import { describe, expect, it } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { EHeaderState, type PullRequestBadge } from '../data/header-model'
import type { PullRequestsView } from '../data/use-pull-requests'
import { ThreadHeader, type ThreadHeaderProps } from '../thread-header'

const BADGE: PullRequestBadge = {
  label: '#12',
  stateLabel: 'Open',
  url: 'https://github.com/o/r/pull/12',
  overflow: 0,
}

const view = (over: Partial<PullRequestsView> = {}): PullRequestsView => ({
  badge: BADGE,
  rows: [
    {
      key: 'o/r#12',
      label: '#12',
      url: BADGE.url,
      branch: 'feat',
      state: 'open',
      checksLabel: undefined,
      failing: false,
      conflicts: false,
    },
  ],
  bells: { 'o/r#12': { watching: false, busy: false, label: 'Watch pull request' } },
  pinnedKey: 'o/r#12',
  handleToggle: () => undefined,
  ...over,
})

const render = (props: Partial<ThreadHeaderProps>): string =>
  renderToStaticMarkup(
    <SidebarProvider>
      <ThreadHeader
        title="Fix the build"
        state={EHeaderState.Idle}
        onOpenPanel={() => undefined}
        {...props}
      />
    </SidebarProvider>,
  )

describe('ThreadHeader', () => {
  it('renders no breadcrumb for a thread nobody spawned', () => {
    expect(render({})).not.toContain('aria-label="Breadcrumb"')
  })

  it('links the spawning thread in the breadcrumb', () => {
    const html = render({ parent: { id: 'lead-1', title: 'Lead thread' } })
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('href="/threads/lead-1"')
    expect(html).toContain('Lead thread')
  })

  it('shows a skeleton instead of a title while the spawner loads', () => {
    const html = render({ parent: { id: 'lead-1', title: null } })
    expect(html).not.toContain('href="/threads/lead-1"')
  })

  it('omits branch and pull request when absent', () => {
    const html = render({})
    expect(html).not.toContain('font-mono')
  })

  it('renders the branch and a pull request link when present', () => {
    const html = render({ branch: 'dennis/feature', pullRequests: view() })
    expect(html).toContain('dennis/feature')
    expect(html).toContain('href="https://github.com/o/r/pull/12"')
    expect(html).toContain('#12')
  })

  it('labels the state badge', () => {
    expect(render({ state: EHeaderState.Running })).toContain('Running')
    expect(render({ state: EHeaderState.Idle })).toContain('Idle')
    expect(render({ state: EHeaderState.Failed })).toContain('Failed')
    expect(render({ state: EHeaderState.NeedsYou })).toContain('Needs you')
  })

  it('renders the pod chip slot content', () => {
    const chip: ReactNode = <span>pod-chip</span>
    expect(render({ podChip: chip })).toContain('pod-chip')
  })

  it('keeps the mobile panel button and New thread link', () => {
    const html = render({})
    expect(html).toContain('aria-label="Open panel"')
    expect(html).toContain('href="/threads/new"')
  })

  it('shows the pinned bell and labels its state', () => {
    const off = render({ pullRequests: view() })
    expect(off).toContain('aria-label="Watch pull request"')
    expect(off).toContain('aria-pressed="false"')

    const on = render({
      pullRequests: view({
        bells: { 'o/r#12': { watching: true, busy: false, label: 'Stop watching pull request' } },
      }),
    })
    expect(on).toContain('aria-pressed="true"')
  })

  it('shows no overflow trigger for a single pull request', () => {
    expect(render({ pullRequests: view() })).not.toContain('more pull requests')
  })

  it('shows the overflow trigger when other pull requests exist', () => {
    const base = view()
    const [first] = base.rows
    const html = render({
      pullRequests: view({
        badge: { ...BADGE, overflow: 2 },
        rows:
          first === undefined
            ? []
            : [first, { ...first, key: 'o/r#13' }, { ...first, key: 'o/r#14' }],
      }),
    })
    expect(html).toContain('aria-label="2 more pull requests"')
    expect(html).toContain('+2')
  })

  it('shows no pull request controls without a badge', () => {
    const html = render({ pullRequests: view({ badge: undefined }) })
    expect(html).not.toContain('Watch pull request')
  })
})
