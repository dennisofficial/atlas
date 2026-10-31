import { describe, expect, it } from 'bun:test'
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

  it('labels the state badge', () => {
    expect(render({ state: EHeaderState.Running })).toContain('Running')
    expect(render({ state: EHeaderState.Idle })).toContain('Idle')
    expect(render({ state: EHeaderState.Failed })).toContain('Failed')
    expect(render({ state: EHeaderState.NeedsYou })).toContain('Needs you')
  })

  it('uses the existing secondary badge for unavailable activity and an accessible reason', () => {
    const html = render({ state: EHeaderState.Unavailable, activityReason: 'Activity unsupported' })
    expect(html).toContain('data-variant="secondary"')
    expect(html).toContain('>Activity unavailable</span>')
    expect(html).toContain('title="Activity unavailable: Activity unsupported"')
    expect(html).toContain('aria-label="Activity unavailable: Activity unsupported"')
  })

  it('keeps the mobile panel button', () => {
    const html = render({})
    expect(html).toContain('aria-label="Open panel"')
  })
})
