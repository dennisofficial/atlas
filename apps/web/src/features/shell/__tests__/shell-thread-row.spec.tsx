import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'
import type { WireThread } from '@dltech/atlas-wire/web'

import { ThreadRow } from '../shell-thread-row'
import { ThreadActionsContext } from '../thread-actions-context'
import { sessionOf, threadOf } from './fixtures'

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
  sessionOf(threadOf({ id: 'run', title: 'Port folder', status: statusOf({ working: true }) })),
  sessionOf(
    threadOf({ id: 'bad', title: 'Fix types', status: statusOf({ lastOutcome: 'failed' }) }),
  ),
  sessionOf(
    threadOf({ id: 'fin', title: 'Write specs', status: statusOf({ lastOutcome: 'completed' }) }),
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
  it('collapses the folder and flags attention when nothing inside is active', () => {
    const html = render(null)
    expect(html).toContain('Show 3 teammates')
    expect(html).toContain('Needs attention')
    expect(html).not.toContain('Port folder')
  })

  it('opens on an active teammate, lists live first and folds done', () => {
    const html = render('run')
    expect(html).toContain('Hide 3 teammates')
    expect(html).toContain('href="/threads/run"')
    expect(html.indexOf('Fix types')).toBeLessThan(html.indexOf('Port folder'))
    expect(html).toContain('1 done')
    expect(html).not.toContain('Write specs')
  })

  it('opens the done group when the active teammate is done', () => {
    expect(render('fin')).toContain('Write specs')
  })

  it('renders a plain row without a toggle when there are no teammates', () => {
    const html = render(null, sessionOf(threadOf({ id: 'solo', title: 'Solo' })))
    expect(html).toContain('href="/threads/solo"')
    expect(html).not.toContain('teammate')
  })
})
