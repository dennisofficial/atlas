import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { SidebarVersionLines } from '../sidebar-version'

const render = (lines: string[]): string =>
  renderToStaticMarkup(
    <SidebarProvider>
      <SidebarVersionLines lines={lines} />
    </SidebarProvider>,
  )

describe('SidebarVersionLines', () => {
  it('renders each line separately after a separator, selectable and untruncated', () => {
    const html = render(['Atlas for Mac 1.179.4', 'web v1.179.4 · 5cc4b0e'])
    expect(html).toContain('data-slot="sidebar-separator"')
    expect(html).toContain('<span class="break-words">Atlas for Mac 1.179.4</span>')
    expect(html).toContain('<span class="break-words">web v1.179.4 · 5cc4b0e</span>')
    expect(html).toContain('select-text')
    expect(html).not.toContain('truncate')
  })

  it('renders nothing when no version is known', () => {
    expect(render([])).not.toContain('sidebar-version')
  })
})
