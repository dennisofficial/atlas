import { describe, expect, it } from 'bun:test'
import { EPlanStatus, type PlanTask } from '@dltech/atlas-core'
import { renderToStaticMarkup } from 'react-dom/server'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { SessionDetailsTab } from '../details-tab'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { paneValueFixture, populatedPaneValue, previewFixture } from './fixture'

const render = (value: SessionPaneValue): string =>
  renderToStaticMarkup(
    <TestQueryProvider client={createTestQueryClient()}>
      <SessionPaneProvider value={value}>
        <SessionDetailsTab />
      </SessionPaneProvider>
    </TestQueryProvider>,
  )

const rowsIn = (html: string): number => html.match(/data-pane-row/g)?.length ?? 0

const previewsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    ...previewFixture,
    serviceId: `svc-${index + 1}`,
    label: `web-${index + 1}`,
    port: 4300 + index + 1,
  }))

describe('SessionDetailsTab', () => {
  it('reads every section from the streamed view', () => {
    const html = render(populatedPaneValue())
    expect(html).toContain('Rebase ui on shadcn base-nova')
    expect(html).toContain('Running')
    expect(html).toContain('aria-label="Pull requests"')
    expect(html).toContain('href="https://github.com/owner/atlas/pull/7"')
    expect(html).toContain('Add the session pane')
    expect(html).toContain('#7')
    expect(html).toContain('CI 3/4')
    expect(html).toContain('Open')
    expect(html).toContain('aria-label="Services"')
    expect(html).toContain(':4321')
    expect(html).toContain('aria-label="Open web"')
    expect(html).toContain('aria-label="Teammates"')
    expect(html).toContain('work the branch')
    expect(html).toContain('map the seam')
    expect(html).toContain('aria-label="Shells"')
    expect(html).toContain('tick 1')
  })

  it('shows the plan above every other list when the session has one', () => {
    const plan: readonly PlanTask[] = [
      { ordinal: 1, text: 'Read the v2 pane brief', status: EPlanStatus.Completed },
      {
        ordinal: 2,
        text: 'Build the details variants',
        status: EPlanStatus.InProgress,
        activeForm: 'Building the details variants',
      },
    ]
    const html = render(paneValueFixture({ view: { ...populatedPaneValue().view, plan } }))
    const todo = html.indexOf('aria-label="Todo"')

    expect(todo).toBeGreaterThan(html.indexOf('data-session-summary'))
    expect(todo).toBeLessThan(html.indexOf('aria-label="Pull requests"'))
    expect(html).toContain('1 / 2 tasks')
    expect(html).toContain('Building the details variants')
  })

  it('has no todo section without a plan', () => {
    expect(render(populatedPaneValue())).not.toContain('aria-label="Todo"')
  })

  it('drops the checkout lines and the subscription list', () => {
    const html = render(populatedPaneValue())
    expect(html).not.toContain('main → dennis/v2-session-pane')
    expect(html).not.toContain('/work/wt')
    expect(html).not.toContain('aria-label="GitHub"')
    expect(html).not.toContain('aria-label="Subscriptions"')
  })

  it('leaves an empty slot for the todo section above the lists', () => {
    const html = render(populatedPaneValue())
    const slot = html.indexOf('data-session-todo-slot')
    expect(slot).toBeGreaterThan(html.indexOf('data-session-summary'))
    expect(slot).toBeLessThan(html.indexOf('aria-label="Pull requests"'))
  })

  it('renders the header and the slot when nothing else streamed', () => {
    const html = render(paneValueFixture())
    expect(html).toContain('data-session-summary')
    expect(html).toContain('data-session-todo-slot')
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain('aria-label="Pull requests"')
    expect(html).not.toContain('aria-label="Services"')
    expect(html).not.toContain('aria-label="Shells"')
    expect(html).not.toContain('aria-label="Teammates"')
  })

  it('shows three rows and a Show all control when a list is longer', () => {
    const html = render(
      paneValueFixture({ view: { ...paneValueFixture().view, previews: previewsOf(5) } }),
    )
    expect(rowsIn(html)).toBe(3)
    expect(html).toContain('Show all (5)')
    expect(html).toContain('web-3')
    expect(html).not.toContain('web-4')
  })

  it('omits the Show all control at exactly three rows', () => {
    const html = render(
      paneValueFixture({ view: { ...paneValueFixture().view, previews: previewsOf(3) } }),
    )
    expect(rowsIn(html)).toBe(3)
    expect(html).not.toContain('Show all')
  })

  it('rings the bell on a pull request row only while it is subscribed', () => {
    const subscribed = render(populatedPaneValue())
    const unsubscribed = render(
      paneValueFixture({
        view: { ...populatedPaneValue().view, subscriptions: [] },
      }),
    )
    expect(subscribed).toContain('aria-label="Unsubscribe from #7"')
    expect(subscribed).toContain('aria-pressed="true"')
    expect(unsubscribed).toContain('aria-label="Subscribe to #7"')
    expect(unsubscribed).toContain('aria-pressed="false"')
  })
})
