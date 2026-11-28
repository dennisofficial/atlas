import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { SidebarVersionLines, SidebarVersionSkeletonLines } from '../sidebar-version'

const render = (lines: string[]): string =>
  renderToStaticMarkup(
    <SidebarProvider>
      <SidebarVersionLines lines={lines} />
    </SidebarProvider>,
  )

describe('SidebarVersionLines', () => {
  it('renders each line separately after a separator, selectable and untruncated', () => {
    const html = render(['App 1.179.4', 'Interface 1.179.4, 5cc4b0e'])
    expect(html).toContain('data-slot="sidebar-separator"')
    expect(html).toContain('<span class="break-words">App 1.179.4</span>')
    expect(html).toContain('<span class="break-words">Interface 1.179.4, 5cc4b0e</span>')
    expect(html).toContain('select-text')
    expect(html).not.toContain('truncate')
  })

  it('renders nothing when no version is known', () => {
    expect(render([])).not.toContain('sidebar-version')
  })
})

const renderSkeleton = (lines: string[]): string =>
  renderToStaticMarkup(
    <SidebarProvider>
      <SidebarVersionSkeletonLines lines={lines} />
    </SidebarProvider>,
  )

describe('SidebarVersionSkeletonLines', () => {
  it('renders one skeleton bar per expected line after a separator', () => {
    const html = renderSkeleton(['App 0.000.0', 'Interface 0123456'])
    expect(html).toContain('data-slot="sidebar-separator"')
    expect(html.match(/data-slot="skeleton"/g)).toHaveLength(2)
    expect(html).not.toContain('Interface')
  })

  it('renders nothing when no version line is expected', () => {
    expect(renderSkeleton([])).not.toContain('sidebar-version-skeleton')
  })
})
