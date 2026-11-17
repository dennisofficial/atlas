import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import { EThinkingVisibility, foldThoughts } from '../thinking-fold'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

const entriesOf = (parts: { type: 'text' | 'reasoning'; text: string }[], stopped: boolean) =>
  deriveTranscript({
    events: log([
      { type: 'user-said', text: 'write me an essay' },
      { type: 'assistant-said', parts, interrupted: true, ...(stopped ? { stopped: true } : {}) },
    ]),
    signals: [],
  }).entries

describe('a reply the operator stopped', () => {
  it('marks the last part of the reply stopped', () => {
    const entries = entriesOf(
      [
        { type: 'reasoning', text: 'planning' },
        { type: 'text', text: 'It was the' },
      ],
      true,
    )

    expect(entries.map((entry) => [entry.kind, 'stopped' in entry])).toEqual([
      [EEntryKind.OperatorSaid, false],
      [EEntryKind.ModelThought, false],
      [EEntryKind.ModelSaid, true],
    ])
  })

  it('keeps the thought and marks it stopped when the model was only thinking', () => {
    const entries = foldThoughts({
      entries: entriesOf([{ type: 'reasoning', text: 'planning' }], true),
      visibility: EThinkingVisibility.Keep,
    })

    expect(entries.at(-1)).toMatchObject({ kind: EEntryKind.ModelThought, stopped: true })
  })

  it('leaves a crash interruption unmarked', () => {
    const entries = entriesOf([{ type: 'text', text: 'It was the' }], false)

    expect(entries.some((entry) => 'stopped' in entry)).toBe(false)
  })
})
