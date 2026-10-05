import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import { EEntryKind, type ParkedEntry } from '../transcript-model'
import { log } from './fixture'

const parkedDividers = (
  events: Parameters<typeof deriveTranscript>[0]['events'],
): ParkedEntry[] =>
  deriveTranscript({ events, signals: [] }).entries.filter(
    (entry): entry is ParkedEntry => entry.kind === EEntryKind.Parked,
  )

const idlePark = {
  type: 'parked',
  reason: 'idle',
  turnRunning: false,
  childrenRunning: 2,
  shellsRunning: 1,
  servicesRunning: 0,
  clientsAttached: 0,
} as const

describe('the parked divider as a logged event', () => {
  it('folds a parked event into a divider carrying the snapshot fields', () => {
    const parkedLog = log([
      { type: 'user-said', text: 'hold that thought' },
      idlePark,
    ])

    const shown = parkedDividers(parkedLog)

    expect(shown).toHaveLength(1)
    expect(shown[0]?.key).toBe(parkedLog[1]?.id)
    expect(shown[0]?.reason).toBe('idle')
    expect(shown[0]?.childrenRunning).toBe(2)
    expect(shown[0]?.shellsRunning).toBe(1)
    expect(shown[0]?.servicesRunning).toBe(0)
  })

  it('pins every park in the log at its own position', () => {
    const twice = log([
      { type: 'user-said', text: 'up it goes' },
      idlePark,
      { type: 'user-said', text: 'again' },
      { ...idlePark, reason: 'idle', childrenRunning: 0 },
    ])

    expect(parkedDividers(twice).map((entry) => entry.key)).toEqual(['event-2', 'event-4'])
  })

  it('shows no divider when the log holds no parked event', () => {
    const home = log([{ type: 'user-said', text: 'still here' }])

    expect(parkedDividers(home)).toHaveLength(0)
  })
})
