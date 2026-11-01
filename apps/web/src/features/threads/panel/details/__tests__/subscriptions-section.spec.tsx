import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import {
  ESubscriptionActorWire,
  ESubscriptionStatusWire,
  PULL_REQUEST_SUBSCRIPTION_PROVIDER,
  type SubscriptionWire,
} from '@dltech/atlas-wire/web'

import { ESubscriptionsStatus, type SubscriptionsData } from '../../../data/use-subscriptions'
import { SubscriptionsSection } from '../subscriptions-section'

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

const subscriptionOf = (over: Partial<SubscriptionWire> = {}): SubscriptionWire => ({
  id: 'sub_1',
  provider: PULL_REQUEST_SUBSCRIPTION_PROVIDER,
  target: { repo: 'github.com/o/r', number: 4 },
  label: 'o/r#4',
  threadId: 'thr_main' as SubscriptionWire['threadId'],
  createdBy: ESubscriptionActorWire.Agent,
  status: ESubscriptionStatusWire.Active,
  createdAt: '2026-10-28T00:00:00.000Z',
  held: 0,
  ...over,
})

const dataOf = (subscriptions: readonly SubscriptionWire[]): SubscriptionsData => ({
  status: ESubscriptionsStatus.Ready,
  subscriptions,
  busy: new Set(),
  setPaused: () => undefined,
  remove: () => undefined,
  subscribePullRequest: () => undefined,
})

async function renderSection(
  subscriptions: readonly SubscriptionWire[],
  teammates: readonly { id: string; title: string }[],
) {
  await act(async () =>
    root.render(<SubscriptionsSection data={dataOf(subscriptions)} teammates={teammates} />),
  )
}

describe('SubscriptionsSection teammate attribution', () => {
  it('shows a via line for a subscription owned by a teammate thread', async () => {
    await renderSection(
      [
        subscriptionOf({ id: 'sub_own', label: 'o/r#4', threadId: 'thr_main' }),
        subscriptionOf({
          id: 'sub_mate',
          label: 'o/r#7',
          target: { repo: 'github.com/o/r', number: 7 },
          threadId: 'mate-1' as SubscriptionWire['threadId'],
        }),
      ],
      [{ id: 'mate-1', title: 'teammate messaging slice B' }],
    )

    expect(container.textContent).toContain('via teammate messaging slice B')
    const rows = [...container.querySelectorAll('[class*="detail-row"]')]
    expect(rows).toHaveLength(2)
    const own = rows.find((row) => row.textContent?.includes('o/r#4'))
    const mate = rows.find((row) => row.textContent?.includes('o/r#7'))
    expect(own?.textContent).not.toContain('via')
    expect(mate?.textContent).toContain('via teammate messaging slice B')
  })

  it("renders no via line for the main session's own subscription", async () => {
    await renderSection(
      [subscriptionOf({ threadId: 'thr_main' })],
      [{ id: 'mate-1', title: 'teammate messaging slice B' }],
    )

    expect(container.textContent).not.toContain('via')
  })
})
