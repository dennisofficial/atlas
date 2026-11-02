import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { CrewLoading, TranscriptLoading } from '../agents/agents-skeletons'
import { ChangesLoading, FilesLoading } from '../changes/tab-skeletons'
import { ThreadViewSkeleton } from '../../thread-view-skeleton'

describe('thread panel skeletons', () => {
  it.each([
    ['changes', <ChangesLoading key="c" />],
    ['files', <FilesLoading key="f" />],
    ['agents', <CrewLoading key="a" />],
    ['transcript', <TranscriptLoading key="t" />],
  ])('renders a labelled %s skeleton without a spinner', (name, node) => {
    const html = renderToStaticMarkup(node)
    expect(html).toContain('role="status"')
    expect(html).toContain(`aria-label="Loading ${name === 'agents' ? 'agents' : name}"`)
    expect(html).toContain('data-slot="skeleton"')
    expect(html).not.toContain('data-slot="spinner"')
  })

  it('renders the thread view skeleton', () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <ThreadViewSkeleton />
      </SidebarProvider>,
    )
    expect(html).toContain('aria-label="Loading thread"')
    expect(html).not.toContain('data-slot="spinner"')
  })
})
