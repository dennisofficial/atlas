import { describe, expect, it } from 'bun:test'
import { EBlockKind } from '@dltech/atlas-core'
import { EStreamBlockKind } from '@dltech/atlas-protocol'

import { EStepEnd, toStepId } from '../../channel'
import type { OpenOverlay } from '../../stream'
import { assembleTranscript } from '../derive-transcript'
import { overlayStepOf } from '../overlay-step'
import { EEntryKind } from '../transcript-model'

const open: OpenOverlay = {
  key: { runId: 'run-1', step: 2, attempt: 0 },
  blocks: [
    { block: 'r0', kind: EStreamBlockKind.Reasoning, text: 'hmm' },
    { block: 't0', kind: EStreamBlockKind.Text, text: 'Hel' },
  ],
  openedAt: 0,
  ended: false,
  settleAt: undefined,
}

describe('overlayStepOf', () => {
  it('is empty when no overlay is open', () => {
    expect(overlayStepOf(undefined)).toEqual([])
  })

  it('maps the key to a step id and the blocks to text and reasoning', () => {
    expect(overlayStepOf(open)).toEqual([
      {
        stepId: toStepId('run-1:2:0'),
        blocks: [
          { id: 'r0', kind: EBlockKind.Reasoning, text: 'hmm' },
          { id: 't0', kind: EBlockKind.Text, text: 'Hel' },
        ],
        calls: [],
        end: null,
        supersededBy: null,
        errorMessage: null,
      },
    ])
  })

  it('marks an ended overlay as a completed step', () => {
    expect(overlayStepOf({ ...open, ended: true })[0]?.end).toBe(EStepEnd.Completed)
  })

  it('gives assembleTranscript a streaming reply and a thought', () => {
    const model = assembleTranscript({ durable: [], live: overlayStepOf(open) })

    expect(model.streaming).toBe(true)
    expect(model.entries.map((entry) => [entry.kind, entry.text])).toEqual([
      [EEntryKind.ModelThought, 'hmm'],
      [EEntryKind.ModelSaid, 'Hel'],
    ])
  })
})
