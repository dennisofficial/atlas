import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '@dltech/atlas-core'

import { DeliveryBuffer, QUIET_WINDOW_MS, type Delivery } from '../delivery-buffer'
import { EOccurrenceUrgency, type SubscriptionOccurrence } from '../provider'
import { FakeClock } from './fake-schedule'

const draftOf = (text: string): EventDraft => ({ type: 'user-said', text })

const occurrence = (
  key: string,
  urgency: EOccurrenceUrgency,
  extra: Partial<SubscriptionOccurrence> = {},
): SubscriptionOccurrence => ({ key, urgency, draft: draftOf(key), ...extra })

const textsOf = (delivery: Delivery | undefined): string[] =>
  (delivery?.drafts ?? []).map((draft) => (draft.type === 'user-said' ? draft.text : '?'))

const bufferOf = (live: (id: string) => boolean = () => true) => {
  const clock = new FakeClock()
  const delivered: Delivery[] = []
  const buffer = new DeliveryBuffer({
    schedule: clock.schedule,
    isLive: live,
    deliver: (delivery) => delivered.push(delivery),
  })
  return { clock, delivered, buffer }
}

describe('DeliveryBuffer', () => {
  it('passes a now occurrence straight through', () => {
    const { delivered, buffer } = bufferOf()
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('a', EOccurrenceUrgency.Now) })
    expect(delivered.map(textsOf)).toEqual([['a']])
  })

  it('holds a batch occurrence until the quiet window passes', () => {
    const { clock, delivered, buffer } = bufferOf()
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('a', EOccurrenceUrgency.Batch) })
    expect(delivered).toEqual([])
    expect(buffer.heldCount({ subscriptionId: 's1' })).toBe(1)

    clock.advance(QUIET_WINDOW_MS - 1)
    expect(delivered).toEqual([])
    clock.advance(1)
    expect(delivered.map(textsOf)).toEqual([['a']])
    expect(buffer.heldCount({ subscriptionId: 's1' })).toBe(0)
  })

  it('restarts the quiet window on each new hold', () => {
    const { clock, delivered, buffer } = bufferOf()
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('a', EOccurrenceUrgency.Batch) })
    clock.advance(QUIET_WINDOW_MS - 10)
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('b', EOccurrenceUrgency.Batch) })
    clock.advance(QUIET_WINDOW_MS - 10)
    expect(delivered).toEqual([])
    clock.advance(10)
    expect(delivered.map(textsOf)).toEqual([['a', 'b']])
  })

  it('lets a later occurrence with the same key supersede the held one', () => {
    const { clock, delivered, buffer } = bufferOf()
    const first = occurrence('ci', EOccurrenceUrgency.Batch)
    buffer.offer({ subscriptionId: 's1', occurrence: first })
    buffer.offer({
      subscriptionId: 's1',
      occurrence: { ...occurrence('ci', EOccurrenceUrgency.Batch), draft: draftOf('ci-2') },
    })
    expect(buffer.heldCount({ subscriptionId: 's1' })).toBe(1)
    clock.advance(QUIET_WINDOW_MS)
    expect(delivered.map(textsOf)).toEqual([['ci-2']])
  })

  it('carries held occurrences with a now occurrence and cancels the timer', () => {
    const { clock, delivered, buffer } = bufferOf()
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('a', EOccurrenceUrgency.Batch) })
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('b', EOccurrenceUrgency.Now) })
    expect(delivered.map(textsOf)).toEqual([['a', 'b']])
    expect(clock.pending()).toBe(0)
    clock.advance(QUIET_WINDOW_MS)
    expect(delivered).toHaveLength(1)
  })

  it('a now occurrence replaces a held one with its own key', () => {
    const { delivered, buffer } = bufferOf()
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('ci', EOccurrenceUrgency.Batch) })
    buffer.offer({
      subscriptionId: 's1',
      occurrence: { ...occurrence('ci', EOccurrenceUrgency.Now), draft: draftOf('ci-fail') },
    })
    expect(delivered.map(textsOf)).toEqual([['ci-fail']])
  })

  it('flushes the held set together with a settling occurrence', () => {
    const { delivered, buffer } = bufferOf()
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('a', EOccurrenceUrgency.Batch) })
    buffer.offer({
      subscriptionId: 's1',
      occurrence: occurrence('green', EOccurrenceUrgency.Batch, { settles: true }),
    })
    expect(delivered.map(textsOf)).toEqual([['a', 'green']])
  })

  it('flushes on an ending occurrence', () => {
    const { delivered, buffer } = bufferOf()
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('a', EOccurrenceUrgency.Batch) })
    buffer.offer({
      subscriptionId: 's1',
      occurrence: occurrence('merged', EOccurrenceUrgency.Batch, { ends: true }),
    })
    expect(delivered.map(textsOf)).toEqual([['a', 'merged']])
  })

  it('keeps subscriptions apart', () => {
    const { delivered, buffer } = bufferOf()
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('a', EOccurrenceUrgency.Batch) })
    buffer.offer({ subscriptionId: 's2', occurrence: occurrence('b', EOccurrenceUrgency.Now) })
    expect(delivered).toEqual([{ subscriptionId: 's2', drafts: [draftOf('b')] }])
    expect(buffer.heldCount({ subscriptionId: 's1' })).toBe(1)
  })

  it('drops an occurrence for a subscription that is not live', () => {
    const { delivered, buffer } = bufferOf(() => false)
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('a', EOccurrenceUrgency.Now) })
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('b', EOccurrenceUrgency.Batch) })
    expect(delivered).toEqual([])
    expect(buffer.heldCount({ subscriptionId: 's1' })).toBe(0)
  })

  it('dropping a subscription discards its held set and timer', () => {
    const { clock, delivered, buffer } = bufferOf()
    buffer.offer({ subscriptionId: 's1', occurrence: occurrence('a', EOccurrenceUrgency.Batch) })
    buffer.drop({ subscriptionId: 's1' })
    clock.advance(QUIET_WINDOW_MS)
    expect(delivered).toEqual([])
    expect(clock.pending()).toBe(0)
  })
})
