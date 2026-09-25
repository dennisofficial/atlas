import { describe, expect, it } from 'vitest'
import type { TranscriptEventDto } from '../factory.types'
import { EFactoryEventKind } from '../factory.types'
import { undeliveredEventsOf } from './wake-recovery'

const event = (id: string, kind: string = EFactoryEventKind.Comment): TranscriptEventDto => ({
  id,
  workItemId: 'fwi_x',
  surface: 'github',
  deliveryId: `d-${id}`,
  author: 'dennislysenko',
  authorAssociation: 'owner',
  kind,
  payload: '{}',
  receivedAt: '2026-09-25T00:00:00.000Z',
})

describe('undeliveredEventsOf', () => {
  it('returns every inbound event when nothing has been delivered yet', () => {
    const events = [event('a'), event('b')]
    expect(undeliveredEventsOf({ events, watermark: null }).map((one) => one.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('drops the orchestrator\'s own reply/station/delivery events so they are never re-fed', () => {
    const events = [
      event('a'),
      event('r', EFactoryEventKind.Reply),
      event('s', EFactoryEventKind.StationRequest),
      event('d', EFactoryEventKind.Delivery),
      event('b'),
    ]
    expect(undeliveredEventsOf({ events, watermark: null }).map((one) => one.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('returns only the events after the watermark', () => {
    const events = [event('a'), event('b'), event('c')]
    expect(undeliveredEventsOf({ events, watermark: 'a' }).map((one) => one.id)).toEqual([
      'b',
      'c',
    ])
  })

  it('returns everything when the watermark names an event that is gone', () => {
    const events = [event('a'), event('b')]
    expect(undeliveredEventsOf({ events, watermark: 'missing' }).map((one) => one.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('returns nothing when the watermark is the last event', () => {
    const events = [event('a'), event('b')]
    expect(undeliveredEventsOf({ events, watermark: 'b' })).toEqual([])
  })
})
