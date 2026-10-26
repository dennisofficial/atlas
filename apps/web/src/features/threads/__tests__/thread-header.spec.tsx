import { describe, expect, it } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { EHeaderState } from '../data/header-model'
import { ThreadHeader, type ThreadHeaderProps } from '../thread-header'

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
    const html = render({
      branch: 'dennis/feature',
      pullRequest: { label: '#12', stateLabel: 'Open', url: 'https://github.com/o/r/pull/12' },
    })
    expect(html).toContain('dennis/feature')
    expect(html).toContain('href="https://github.com/o/r/pull/12"')
    expect(html).toContain('#12')
  })

  it('labels the state badge', () => {
    expect(render({ state: EHeaderState.Running })).toContain('Running')
    expect(render({ state: EHeaderState.Idle })).toContain('Idle')
    expect(render({ state: EHeaderState.Failed })).toContain('Failed')
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
})
