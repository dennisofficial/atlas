import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { deriveTranscript } from '../derive-transcript'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

describe('the rotated divider as a logged event', () => {
  it('names the predecessor and the handoff path, pinned where the event landed', () => {
    const events = log([
      { type: 'rotated', predecessor: toThreadId('thr_old'), handoffPath: '/s/context/handoffs/op.md' },
      { type: 'user-said', text: 'carry on' },
    ])

    const entries = deriveTranscript({ events, signals: [] }).entries
    const divider = entries.find((entry) => entry.kind === EEntryKind.Rotated)

    expect(divider).toMatchObject({
      kind: EEntryKind.Rotated,
      key: events[0]?.id,
      predecessor: 'thr_old',
      handoffPath: '/s/context/handoffs/op.md',
    })
    expect(entries.findIndex((entry) => entry.kind === EEntryKind.Rotated)).toBe(0)
  })
})
