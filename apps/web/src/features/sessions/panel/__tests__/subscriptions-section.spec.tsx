import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { ESubscriptionActor, ESubscriptionStatus, ESubscriptionTone } from '@dltech/atlas-core'
import type { SubscriptionListRow } from '@dltech/atlas-plugin-github/client'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { SessionSubscriptionsSection, type SubscriptionRun } from '../details/subscriptions-section'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { paneValueFixture, populatedPaneValue, subscriptionRowFixture } from './fixture'

const valueOf = (rows: readonly SubscriptionListRow[]): SessionPaneValue =>
  paneValueFixture({ view: { ...populatedPaneValue().view, subscriptionRows: rows } })

const render = (value: SessionPaneValue): string =>
  renderToStaticMarkup(
    <TestQueryProvider client={createTestQueryClient()}>
      <SessionPaneProvider value={value}>
        <SessionSubscriptionsSection />
      </SessionPaneProvider>
    </TestQueryProvider>,
  )

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await GlobalRegistrator.unregister()
})

const press = async (
  value: SessionPaneValue,
  label: string,
): Promise<Awaited<Parameters<SubscriptionRun>[0]>[]> => {
  const sent: Awaited<Parameters<SubscriptionRun>[0]>[] = []
  await act(async () =>
    root.render(
      <SessionPaneProvider value={value}>
        <SessionSubscriptionsSection
          run={async (args) => {
            sent.push(args)
          }}
        />
      </SessionPaneProvider>,
    ),
  )
  const control = container.querySelector(`[aria-label="${label}"]`)
  if (control === null) throw new Error(`no ${label} control`)
  await act(async () => (control as HTMLElement).click())
  return sent
}

describe('SessionSubscriptionsSection', () => {
  it('hides the section when the session follows nothing', () => {
    expect(render(valueOf([]))).not.toContain('aria-label="Subscriptions"')
  })

  it('renders one row with the plugin title and the meta line', () => {
    const html = render(valueOf([subscriptionRowFixture()]))
    expect(html).toContain('aria-label="Subscriptions"')
    expect(html).toContain('<span class="font-mono">#7</span>')
    expect(html).toContain('Add the session pane')
    expect(html).toContain('Pull request · all events · Agent')
    expect(html).toContain('aria-label="Pause #7 Add the session pane"')
    expect(html).toContain('aria-label="Remove #7 Add the session pane"')
  })

  it('counts the held events and the time left on an expiring subscription', () => {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const html = render(valueOf([subscriptionRowFixture({ held: 3, expiresAt })]))
    expect(html).toContain('3 held')
    expect(html).toContain('Expires in 2h')
  })

  it('fades a paused row and says so in its meta line', () => {
    const html = render(valueOf([subscriptionRowFixture({ status: ESubscriptionStatus.Paused })]))
    expect(html).toContain('opacity-50')
    expect(html).toContain('font-medium">Paused · </span>')
    expect(html).toContain('aria-label="Resume #7 Add the session pane"')
  })

  it('names the actor that created the subscription', () => {
    const html = render(
      valueOf([subscriptionRowFixture({ createdBy: ESubscriptionActor.Operator })]),
    )
    expect(html).toContain('· You')
  })

  it('leaves the number out of the monospace lead for a title that has none', () => {
    const html = render(
      valueOf([
        subscriptionRowFixture({
          provider: 'github.workflow-run',
          number: undefined,
          presentation: {
            icon: 'circle-play',
            tone: ESubscriptionTone.Running,
            title: 'deploy.yml@main',
            meta: ['Workflow run'],
          },
        }),
      ]),
    )
    expect(html).toContain('deploy.yml@main')
    expect(html).not.toContain('<span class="font-mono">')
  })

  it('shows five rows and offers the rest', () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      subscriptionRowFixture({ id: `sub_${index + 1}`, number: index + 1 }),
    )
    const html = render(valueOf(rows))
    expect(html.match(/data-subscription-row/g)?.length).toBe(5)
    expect(html).toContain('Show all (6)')
  })

  it('pauses an active subscription', async () => {
    const sent = await press(valueOf([subscriptionRowFixture()]), 'Pause #7 Add the session pane')
    expect(sent).toEqual([
      {
        sessionId: 'ses-1',
        command: {
          name: 'set-subscription-status',
          args: { subscriptionId: 'sub_7', status: ESubscriptionStatus.Paused },
        },
      },
    ])
  })

  it('resumes a paused subscription', async () => {
    const sent = await press(
      valueOf([subscriptionRowFixture({ status: ESubscriptionStatus.Paused })]),
      'Resume #7 Add the session pane',
    )
    expect(sent).toEqual([
      {
        sessionId: 'ses-1',
        command: {
          name: 'set-subscription-status',
          args: { subscriptionId: 'sub_7', status: ESubscriptionStatus.Active },
        },
      },
    ])
  })

  it('removes a subscription', async () => {
    const sent = await press(valueOf([subscriptionRowFixture()]), 'Remove #7 Add the session pane')
    expect(sent).toEqual([
      { sessionId: 'ses-1', command: { name: 'unsubscribe', args: { subscriptionId: 'sub_7' } } },
    ])
  })
})
