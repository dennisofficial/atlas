import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { deriveTranscript } from '../derive-transcript'
import { EEntryKind, type TranscriptEntry } from '../transcript-model'
import { log } from './fixture'

const dividers = (
  events: Parameters<typeof deriveTranscript>[0]['events'],
  location: EExecutionLocation | undefined,
): { key: string; to: EExecutionLocation }[] =>
  deriveTranscript({ events, signals: [], location })
    .entries.filter(
      (entry): entry is TranscriptEntry & { to: EExecutionLocation } =>
        entry.kind === EEntryKind.LocationChanged,
    )
    .map((entry) => ({ key: entry.key, to: entry.to }))

// The log of a thread that lifted, came home, and said one more thing: the descend's marker is
// the last location event it holds. The re-lift ships this exact log up — its own marker lands
// locally only after the archive sealed.
const descendedLog = log([
  { type: 'user-said', text: 'get it running' },
  { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
  { type: 'user-said', text: 'keep it going from up there' },
  { type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Host },
  { type: 'user-said', text: 'back up it goes' },
])

describe('the cloud line on a lift after a descend', () => {
  it('leaves the divider at current placement, past the descend marker the archive still carries', () => {
    const shown = dividers(descendedLog, EExecutionLocation.Cloud)

    expect(shown.at(-1)?.to).toBe(EExecutionLocation.Cloud)
    expect(shown.at(-1)?.key).toBe('placement-divider')
  })

  it('does not synthesize a marker while the session is home', () => {
    const home = log([
      { type: 'user-said', text: 'still here' },
      { type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Host },
    ])

    const shown = dividers(home, EExecutionLocation.Host)

    expect(shown).toHaveLength(1)
    expect(shown.at(-1)?.to).toBe(EExecutionLocation.Host)
  })

  it('does not double the line when the log already ends at the cloud', () => {
    const firstLiftLog = log([
      { type: 'user-said', text: 'take it up' },
      { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
    ])

    const shown = dividers(firstLiftLog, EExecutionLocation.Cloud)

    expect(shown).toHaveLength(1)
    expect(shown.at(-1)?.to).toBe(EExecutionLocation.Cloud)
  })
})
