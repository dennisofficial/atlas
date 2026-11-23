import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

describe('the rotated divider as a logged event', () => {
  it('carries the brief, pinned where the event landed', () => {
    const events = log([
      {
        type: 'rotated',
        handoff: 'the plan, the files and the branch',
        instructions: 'keep the auth notes',
      },
      { type: 'user-said', text: 'carry on' },
    ])

    const entries = deriveTranscript({ events, signals: [] }).entries
    const divider = entries.find((entry) => entry.kind === EEntryKind.Rotated)

    expect(divider).toMatchObject({
      kind: EEntryKind.Rotated,
      key: events[0]?.id,
      text: 'context rotated here',
      handoff: 'the plan, the files and the branch',
      instructions: 'keep the auth notes',
    })
    expect(entries.findIndex((entry) => entry.kind === EEntryKind.Rotated)).toBe(0)
  })

  it('says how full the window was when the rotation ran by itself', () => {
    const events = log([{ type: 'rotated', handoff: 'the brief', auto: { percent: 86 } }])

    const entries = deriveTranscript({ events, signals: [] }).entries
    const divider = entries.find((entry) => entry.kind === EEntryKind.Rotated)

    expect(divider?.text).toBe('rotated automatically at 86% of the window')
  })
})
