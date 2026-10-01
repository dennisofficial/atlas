import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { deriveTranscript } from '../derive-transcript'
import { EEntryKind, type TranscriptEntry } from '../transcript-model'
import { log } from './fixture'

const dividers = (
  events: Parameters<typeof deriveTranscript>[0]['events'],
): { key: string; to: EExecutionLocation }[] =>
  deriveTranscript({ events, signals: [] })
    .entries.filter(
      (entry): entry is TranscriptEntry & { to: EExecutionLocation } =>
        entry.kind === EEntryKind.LocationChanged,
    )
    .map((entry) => ({ key: entry.key, to: entry.to }))

// The log of a thread that lifted, came home, and said one more thing: every move pinned its own
// `location-changed` event, so the transcript the operator reads carries the full trail inline.
const descendedLog = log([
  { type: 'user-said', text: 'get it running' },
  { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
  { type: 'user-said', text: 'keep it going from up there' },
  { type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Host },
  { type: 'user-said', text: 'back up it goes' },
])

describe('the location divider as a logged event', () => {
  it('renders exactly the markers the log holds, pinned where each move landed', () => {
    const shown = dividers(descendedLog)

    expect(shown.map((entry) => entry.to)).toEqual([
      EExecutionLocation.Cloud,
      EExecutionLocation.Host,
    ])
    // A logged event's key is its event id — never a synthesized placement key.
    expect(shown.every((entry) => entry.key !== 'placement-divider')).toBe(true)
  })

  it('never synthesizes a divider from placement — a log with no marker shows none', () => {
    const home = log([{ type: 'user-said', text: 'still here' }])

    expect(dividers(home)).toHaveLength(0)
  })

  it('keeps a single divider when the log already ends at the cloud', () => {
    const liftedLog = log([
      { type: 'user-said', text: 'take it up' },
      { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
    ])

    const shown = dividers(liftedLog)
    expect(shown).toHaveLength(1)
    expect(shown.at(-1)?.to).toBe(EExecutionLocation.Cloud)
  })
})
