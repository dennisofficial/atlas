import { describe, expect, it } from 'bun:test'
import { EPlanStatus, type PlanTask } from '@dltech/atlas-core'
import { renderToStaticMarkup } from 'react-dom/server'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { contextDirectoryKey } from '../../data/context-files'
import { SessionDetailsTab } from '../details-tab'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { paneValueFixture, populatedPaneValue, serviceRowFixture } from './fixture'

const client = (value: SessionPaneValue) => {
  const created = createTestQueryClient()
  created.setQueryData(contextDirectoryKey({ sessionId: value.sessionId, directory: '' }), [])
  return created
}

const render = (value: SessionPaneValue): string =>
  renderToStaticMarkup(
    <TestQueryProvider client={client(value)}>
      <SessionPaneProvider value={value}>
        <SessionDetailsTab />
      </SessionPaneProvider>
    </TestQueryProvider>,
  )

const rowsIn = (html: string): number => html.match(/data-pane-row/g)?.length ?? 0

const serviceRowsOf = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    serviceRowFixture({
      serviceId: `svc-${index + 1}`,
      name: `web-${index + 1}`,
      port: 4300 + index + 1,
      url: `https://${4301 + index}-abc.byatlas.dev`,
    }),
  )

describe('SessionDetailsTab', () => {
  it('reads every section from the streamed view', () => {
    const html = render(populatedPaneValue())
    expect(html).toContain('Rebase ui on shadcn base-nova')
    expect(html).toContain('Running')
    expect(html).toContain('aria-label="Pull requests"')
    expect(html).toContain('href="https://github.com/owner/atlas/pull/7"')
    expect(html).toContain('#7')
    expect(html).toContain('aria-label="1 running, 3 passed, 0 failed"')
    expect(html).toContain('aria-label="Services"')
    expect(html).toContain(':4321')
    expect(html).toContain('aria-label="Open web"')
    expect(html).toContain('aria-label="Sub-agents"')
    expect(html).toContain('work the branch')
    expect(html).toContain('map the seam')
    expect(html).toContain('aria-label="Background"')
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

  it('shows spend and token usage under the header', () => {
    const spend = {
      inputTokens: 150_000,
      outputTokens: 12_000,
      cacheReadTokens: 100_000,
      cacheWriteTokens: 0,
      uncachedInputTokens: 50_000,
      costUsd: 1.23,
    }
    const html = render(paneValueFixture({ view: { ...paneValueFixture().view, spend } }))
    expect(html).toContain('data-session-spend')
    expect(html).toContain('$1.23')
    expect(html).toContain('aria-label="Input tokens"')
    expect(html).toContain('aria-label="Output tokens"')
    expect(html).toContain('cached')
  })

  it('hides the spend line before any model call', () => {
    expect(render(paneValueFixture())).not.toContain('data-session-spend')
  })

  it('shows every section heading with an empty line when nothing streamed', () => {
    const html = render(paneValueFixture())
    expect(html).toContain('aria-label="Todo"')
    expect(html).toContain('No plan yet')
    expect(html).toContain('aria-label="Pull requests"')
    expect(html).toContain('No pull requests yet')
    expect(html).toContain('aria-label="Context"')
    expect(html).toContain('No context files yet')
    expect(html).toContain('aria-label="Subscriptions"')
    expect(html).toContain('No subscriptions')
    expect(html).toContain('aria-label="Services"')
    expect(html).toContain('No services running')
    expect(html).toContain('aria-label="Sub-agents"')
    expect(html).toContain('No sub-agents yet')
    expect(html).toContain('aria-label="Background"')
    expect(html).toContain('Nothing running in the background')
  })

  it('drops the checkout lines and the GitHub section', () => {
    const html = render(populatedPaneValue())
    expect(html).not.toContain('main → dennis/v2-session-pane')
    expect(html).not.toContain('/work/wt')
    expect(html).not.toContain('aria-label="GitHub"')
  })

  it('lists the subscriptions under the pull requests', () => {
    const html = render(populatedPaneValue())
    const subscriptions = html.indexOf('aria-label="Subscriptions"')
    expect(subscriptions).toBeGreaterThan(html.indexOf('aria-label="Pull requests"'))
    expect(subscriptions).toBeLessThan(html.indexOf('aria-label="Services"'))
    expect(html).toContain('Add the session pane')
  })

  it('says nothing is followed when the session follows nothing', () => {
    expect(render(paneValueFixture())).toContain('No subscriptions')
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
  })

  it('shows three rows and a Show all control when a list is longer', () => {
    const html = render(
      paneValueFixture({ view: { ...paneValueFixture().view, serviceRows: serviceRowsOf(5) } }),
    )
    expect(rowsIn(html)).toBe(3)
    expect(html).toContain('Show all (5)')
    expect(html).toContain('web-3')
    expect(html).not.toContain('web-4')
  })

  it('omits the Show all control at exactly three rows', () => {
    const html = render(
      paneValueFixture({ view: { ...paneValueFixture().view, serviceRows: serviceRowsOf(3) } }),
    )
    expect(rowsIn(html)).toBe(3)
    expect(html).not.toContain('Show all')
  })

  it('rings the bell on a pull request row only while it is subscribed', () => {
    const subscribed = render(populatedPaneValue())
    const unsubscribed = render(
      paneValueFixture({
        view: { ...populatedPaneValue().view, subscriptionRows: [] },
      }),
    )
    expect(subscribed).toContain('aria-label="Unsubscribe from #7"')
    expect(subscribed).toContain('aria-pressed="true"')
    expect(unsubscribed).toContain('aria-label="Subscribe to #7"')
    expect(unsubscribed).toContain('aria-pressed="false"')
  })
})
