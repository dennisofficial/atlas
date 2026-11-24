import { toCallId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import type { TranscriptEntryFold } from '../entry-builders'
import { EAuthor, EEntryKind } from '../transcript-model'
import { log } from './fixture'

const foldOnParked: TranscriptEntryFold = (events) => {
  const found = events.find((event) => event.type === 'tool-parked')
  if (found === undefined) return new Map()

  return new Map([
    [
      found.id,
      {
        kind: EEntryKind.Rotated,
        author: EAuthor.Model,
        key: found.id,
        text: 'a plugin row',
        handoff: 'handed over',
      },
    ],
  ])
}

const events = log([
  {
    type: 'tool-parked',
    callId: toCallId('call_1'),
    name: 'operator_input',
    request: { kind: 'input', prompt: 'paste the token' },
  },
])

describe('deriveTranscript with plugin folds', () => {
  it('draws the entry a plugin fold returns for an event', () => {
    const model = deriveTranscript({ events, signals: [], pluginEntries: [foldOnParked] })

    expect(model.entries.map((entry) => entry.kind)).toContain(EEntryKind.Rotated)
  })

  it('draws nothing from a plugin when no fold is passed', () => {
    const model = deriveTranscript({ events, signals: [] })

    expect(model.entries.map((entry) => entry.kind)).not.toContain(EEntryKind.Rotated)
  })
})
