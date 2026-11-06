import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { ThreadRow } from '../shell-thread-row'
import { ThreadActionsContext } from '../thread-actions-context'
import { v2RowOf } from '../v2-rows'
import { agoIso, sessionOf, threadOf } from './fixtures'

const render = (session: Parameters<typeof ThreadRow>[0]['session']) =>
  renderToStaticMarkup(
    <SidebarProvider>
      <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
        <ThreadRow session={session} projectName="atlas" activeThreadId={null} />
      </ThreadActionsContext.Provider>
    </SidebarProvider>,
  )

const documentOf = (html: string) => new DOMParser().parseFromString(html, 'text/html')

const v1 = sessionOf(threadOf({ id: 'a', title: 'A title', pinnedAt: agoIso(1) }))

describe('sidebar row action layout', () => {
  it('sizes the trailing column from its content instead of reserving padding', () => {
    const html = render(v1)
    expect(html).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(html).toContain('data-row-trailing')
    expect(html).not.toContain('pr-12')
    expect(html).not.toContain('absolute')
  })

  it('keeps the actions outside the link and in the trailing cell', async () => {
    const { GlobalRegistrator } = await import('@happy-dom/global-registrator')
    GlobalRegistrator.register()
    try {
      const doc = documentOf(render(v1))
      const trailing = doc.querySelector('[data-row-trailing]')
      const link = doc.querySelector('a[href="/threads/a"]')
      expect(trailing?.querySelector('button[aria-label="Archive thread"]')).not.toBeNull()
      expect(link?.querySelector('button')).toBeNull()
      expect(link?.contains(trailing ?? null)).toBe(false)
    } finally {
      await GlobalRegistrator.unregister()
    }
  })

  it('gives a v2 row the archive action without reserved padding', () => {
    const html = render(
      v2RowOf({
        sessionId: 'v2-a',
        projectId: 'p1',
        title: 'Fix login',
        mainThreadId: 'thr-a',
        createdAt: agoIso(5),
        updatedAt: agoIso(2),
      }),
    )
    expect(html).toContain('Archive thread')
    expect(html).not.toContain('pr-12')
  })
})
