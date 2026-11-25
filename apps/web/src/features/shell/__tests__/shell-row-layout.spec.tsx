import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'

import { ThreadRow } from '../shell-thread-row'
import { ThreadActionsContext } from '../thread-actions-context'
import { rowOf } from '../session-rows'
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
    registerDom()
    try {
      const doc = documentOf(render(v1))
      const trailing = doc.querySelector('[data-row-trailing]')
      const link = doc.querySelector('a[href="/threads/a"]')
      expect(trailing?.querySelector('button[aria-label="Archive thread"]')).not.toBeNull()
      expect(link?.querySelector('button')).toBeNull()
      expect(link?.contains(trailing ?? null)).toBe(false)
    } finally {
      await unregisterDom()
    }
  })

  it('keeps the actions shown while a popup they anchor is open', async () => {
    registerDom()
    try {
      const doc = documentOf(render(v1))
      const actions = doc.querySelector('[data-row-actions]')
      expect(actions?.className).toContain('group-has-[[data-popup-open]]/thread:flex')
    } finally {
      await unregisterDom()
    }
  })

  it('gives a v2 row the archive action without reserved padding', () => {
    const html = render(
      rowOf({
        sessionId: 'ses-a',
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
