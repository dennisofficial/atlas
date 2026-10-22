import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

const idlePark = {
  type: 'parked',
  reason: 'idle',
  turnRunning: false,
  childrenRunning: 2,
  shellsRunning: 1,
  servicesRunning: 0,
  clientsAttached: 0,
} as const

const shapeOf = (events: Parameters<typeof deriveTranscript>[0]['events']) =>
  deriveTranscript({ events, signals: [] }).entries.map((entry) => [entry.kind, entry.text] as const)

describe('a parked event in the log', () => {
  it('leaves a thread that only ever parked with an empty transcript', () => {
    const model = deriveTranscript({ events: log([idlePark]), signals: [] })

    expect(model.entries).toEqual([])
    expect(model.isEmpty).toBe(true)
  })

  it('adds no entry between the messages around it and keeps their order', () => {
    const events = log([
      { type: 'user-said', text: 'hold that thought' },
      idlePark,
      { type: 'assistant-said', parts: [{ type: 'text', text: 'held.' }] },
      idlePark,
      { type: 'user-said', text: 'back again' },
    ])

    expect(shapeOf(events)).toEqual([
      [EEntryKind.OperatorSaid, 'hold that thought'],
      [EEntryKind.ModelSaid, 'held.'],
      [EEntryKind.OperatorSaid, 'back again'],
    ])
  })

  it('shows nothing for repeated parks and leaves the event log untouched', () => {
    const events = log([
      { type: 'user-said', text: 'up it goes' },
      idlePark,
      { ...idlePark, childrenRunning: 0 },
      { ...idlePark, reason: 'shutdown' },
    ])
    const before = JSON.stringify(events)

    const model = deriveTranscript({ events, signals: [] })

    expect(model.entries.map((entry) => entry.kind)).toEqual([EEntryKind.OperatorSaid])
    expect(JSON.stringify(events)).toBe(before)
    expect(events.map((event) => event.type)).toEqual(['user-said', 'parked', 'parked', 'parked'])
  })
})
