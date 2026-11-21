import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { ESubscriptionActor, ESubscriptionTone } from '@dltech/atlas-core'
import type { SubscriptionListRow } from '@dltech/atlas-plugin-github/client'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { toast } from 'sonner'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { SessionSubscriptionsSection, type SubscriptionRun } from '../details/subscriptions-section'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { paneValueFixture, populatedPaneValue, subscriptionRowFixture } from './fixture'

const TAKEN = '#7 Add the session pane'

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
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await unregisterDom()
})

const mount = async (args: { value: SessionPaneValue; run: SubscriptionRun }) => {
  await act(async () =>
    root.render(
      <SessionPaneProvider value={args.value}>
        <SessionSubscriptionsSection run={args.run} />
      </SessionPaneProvider>,
    ),
  )
}

const click = async (label: string) => {
  const control = container.querySelector(`[aria-label="${label}"]`)
  if (control === null) throw new Error(`no ${label} control`)
  await act(async () => (control as HTMLElement).click())
}

const rowSelector = '[data-subscription-row="sub_7"]'

const press = async (value: SessionPaneValue, label: string) => {
  const sent: Awaited<Parameters<SubscriptionRun>[0]>[] = []
  await mount({
    value,
    run: async (args) => {
      sent.push(args)
    },
  })
  await click(label)
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
    expect(html).toContain(`aria-label="Remove ${TAKEN}"`)
  })

  it('counts the held events and the time left on an expiring subscription', () => {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const html = render(valueOf([subscriptionRowFixture({ held: 3, expiresAt })]))
    expect(html).toContain('3 held')
    expect(html).toContain('Expires in 2h')
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

  it('sends unsubscribe for the trash click', async () => {
    const sent = await press(valueOf([subscriptionRowFixture()]), `Remove ${TAKEN}`)
    expect(sent).toEqual([
      { sessionId: 'ses-1', command: { name: 'unsubscribe', args: { subscriptionId: 'sub_7' } } },
    ])
  })

  it('hides the row before the log answers', async () => {
    await mount({ value: valueOf([subscriptionRowFixture()]), run: async () => undefined })
    expect(container.querySelector(rowSelector)).not.toBeNull()
    await click(`Remove ${TAKEN}`)
    expect(container.querySelector(rowSelector)).toBeNull()
  })

  it('drops the section with the last row it removed', async () => {
    await mount({ value: valueOf([subscriptionRowFixture()]), run: async () => undefined })
    await click(`Remove ${TAKEN}`)
    expect(container.querySelector('[aria-label="Subscriptions"]')).toBeNull()
  })

  it('puts the row back and says why when the command fails', async () => {
    const errors = spyOn(toast, 'error').mockImplementation(() => 'toast')
    await mount({
      value: valueOf([subscriptionRowFixture()]),
      run: async () => {
        throw new Error('the holder is gone')
      },
    })
    await click(`Remove ${TAKEN}`)
    expect(container.querySelector(rowSelector)).not.toBeNull()
    expect(errors.mock.calls[0]?.[0]).toBe('the holder is gone')
    errors.mockRestore()
  })
})
