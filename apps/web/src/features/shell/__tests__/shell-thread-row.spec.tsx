import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'
import type { WireThread } from '@dltech/atlas-wire/web'

import { ThreadRow } from '../shell-thread-row'
import { ThreadActionsContext } from '../thread-actions-context'
import { agoIso, sessionOf, threadOf } from './fixtures'

const statusOf = (status: Partial<NonNullable<WireThread['status']>>) =>
  ({
    working: false,
    awaiting: null,
    lastOutcome: null,
    podState: 'running',
    lastAssistantSeq: 0,
    ...status,
  }) as NonNullable<WireThread['status']>

const manager = sessionOf(threadOf({ id: 'boss', title: 'Ship sidebar' }), [
  sessionOf(
    threadOf({
      id: 'run',
      title: 'Port folder',
      status: statusOf({ working: true }),
    }),
  ),
  sessionOf(
    threadOf({
      id: 'bad',
      title: 'Fix types',
      status: statusOf({ lastOutcome: 'failed' }),
    }),
  ),
  sessionOf(
    threadOf({
      id: 'fin',
      title: 'Write specs',
      archivedAt: agoIso(1),
      status: statusOf({ lastOutcome: 'completed' }),
    }),
  ),
])

const render = (activeThreadId: string | null, session = manager): string =>
  renderToStaticMarkup(
    <SidebarProvider>
      <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
        <ThreadRow session={session} projectName="atlas" activeThreadId={activeThreadId} />
      </ThreadActionsContext.Provider>
    </SidebarProvider>,
  )

describe('ThreadRow with teammates', () => {
  it('always lists teammates expanded without a lead toggle or count', () => {
    const html = render(null)
    expect(html).toContain('Port folder')
    expect(html).toContain('Fix types')
    expect(html).not.toContain('teammate')
    expect(html).not.toContain('Show')
    expect(html).not.toContain('Hide')
  })

  it('orders attention ahead of running teammates', () => {
    const html = render('run')
    expect(html.indexOf('Fix types')).toBeLessThan(html.indexOf('Port folder'))
  })

  it('keeps a completed teammate in the active list', () => {
    const completed = sessionOf(threadOf({ id: 'boss', title: 'Ship sidebar' }), [
      sessionOf(
        threadOf({
          id: 'fin',
          title: 'Write specs',
          status: statusOf({ lastOutcome: 'completed' }),
        }),
      ),
    ])
    expect(render(null, completed)).toContain('Write specs')
  })

  it('folds archived teammates into a collapsed Done group', () => {
    const html = render(null)
    expect(html).not.toContain('href="/threads/fin"')
    expect(html).toContain('Done')
    expect(html).toContain('aria-expanded="false"')
  })

  it('renders no Done group without archived teammates', () => {
    const unarchived = sessionOf(threadOf({ id: 'boss', title: 'Ship sidebar' }), [
      sessionOf(threadOf({ id: 'run', title: 'Port folder', status: statusOf({ working: true }) })),
    ])
    expect(render(null, unarchived)).not.toContain('Done')
  })

  it('expands the Done group when the archived teammate is the active thread', () => {
    const html = render('fin')
    expect(html).toContain('href="/threads/fin"')
    expect(html).toContain('aria-expanded="true"')
  })

  it('offers archive on a teammate row and unarchive on a done one', () => {
    expect(render(null)).toContain('aria-label="Archive thread"')
    expect(render('fin')).toContain('aria-label="Unarchive thread"')
  })

  it('renders a plain row when there are no teammates', () => {
    const html = render(null, sessionOf(threadOf({ id: 'solo', title: 'Solo' })))
    expect(html).toContain('href="/threads/solo"')
    expect(html).not.toContain('Done')
  })

  describe('title growth', () => {
    const titleClassOf = (html: string): string =>
      html.match(/<span aria-live="polite"[^>]*class="([^"]*)"/)?.[1] ?? ''

    it('grows the title so the local icon sits at the trailing edge', () => {
      const html = render(
        null,
        sessionOf(threadOf({ id: 'mac', title: 'On Mac', runner: 'local' })),
      )
      expect(titleClassOf(html).split(' ')).toContain('flex-1')
      expect(html).toContain('aria-label="This Mac"')
      expect(html.indexOf('On Mac')).toBeLessThan(html.indexOf('aria-label="This Mac"'))
    })

    it('grows the cloud title too and shows no local icon', () => {
      const html = render(
        null,
        sessionOf(threadOf({ id: 'sandbox', title: 'In cloud', runner: 'cloud' })),
      )
      expect(titleClassOf(html).split(' ')).toContain('flex-1')
      expect(html).not.toContain('This Mac')
    })
  })
})
