import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  ESubscriptionActorWire,
  ESubscriptionStatusWire,
  type SubscriptionWire,
} from '@dltech/atlas-wire/web'

import { ESubscriptionsStatus, type SubscriptionsData } from '../../data/use-subscriptions'
import type { ServeChannel } from '../../data/live-thread-view'
import { SubscriptionsTab } from '../subscriptions-tab'
import { ThreadPanelProvider, type ThreadPanelValue } from '../thread-panel-context'

const panel = (connected: boolean): ThreadPanelValue => ({
  threadId: 'thr_1',
  channel: connected ? ({} as ServeChannel) : null,
  pod: null,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  clearAgent: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
})

const subscription = (over: Partial<SubscriptionWire> = {}): SubscriptionWire => ({
  id: 'sub_1',
  provider: 'github.pull-request',
  target: { repo: 'github.com/o/r', number: 4 },
  label: 'o/r#4',
  threadId: 'thr_1' as SubscriptionWire['threadId'],
  createdBy: ESubscriptionActorWire.Agent,
  status: ESubscriptionStatusWire.Active,
  createdAt: '2026-10-28T00:00:00.000Z',
  held: 0,
  ...over,
})

const render = (args: { data?: Partial<SubscriptionsData>; connected?: boolean }): string =>
  renderToStaticMarkup(
    <ThreadPanelProvider value={panel(args.connected ?? true)}>
      <SubscriptionsTab
        data={{
          status: ESubscriptionsStatus.Ready,
          subscriptions: [],
          busy: new Set(),
          setPaused: () => undefined,
          remove: () => undefined,
          subscribePullRequest: () => undefined,
          ...args.data,
        }}
      />
    </ThreadPanelProvider>,
  )

describe('SubscriptionsTab', () => {
  it('explains how subscriptions arrive when there are none', () => {
    const html = render({})
    expect(html).toContain('No subscriptions')
    expect(html).toContain('The agent subscribes with the subscribe tool')
  })

  it('waits for the pod without a channel', () => {
    expect(render({ connected: false })).toContain('Connecting to the pod')
  })

  it('spins while loading', () => {
    expect(render({ data: { status: ESubscriptionsStatus.Loading } })).toContain(
      'data-slot="spinner"',
    )
  })

  it('says an old serve cannot manage subscriptions', () => {
    expect(render({ data: { status: ESubscriptionsStatus.Unsupported } })).toContain(
      'too old to manage subscriptions',
    )
  })

  it('lists a row with its label, detail and controls', () => {
    const html = render({ data: { subscriptions: [subscription({ held: 2 })] } })
    expect(html).toContain('o/r#4')
    expect(html).toContain('Pull request · Agent · 2 held')
    expect(html).toContain('aria-label="Pause o/r#4"')
    expect(html).toContain('aria-label="Remove o/r#4"')
  })

  it('marks a paused row and offers resume', () => {
    const html = render({
      data: { subscriptions: [subscription({ status: ESubscriptionStatusWire.Paused })] },
    })
    expect(html).toContain('Paused')
    expect(html).toContain('aria-label="Resume o/r#4"')
  })
})
