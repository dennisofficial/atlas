import { EOperatorInputOutcome } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { deriveTranscript } from '../derive-transcript'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

describe('durable operator input outcomes', () => {
  it.each([
    [EOperatorInputOutcome.Delivered, "the operator's pasted value was delivered (12000 bytes)"],
    [EOperatorInputOutcome.Undelivered, 'the operator input could not be delivered'],
    [EOperatorInputOutcome.Cancelled, 'the operator input request was cancelled'],
  ])('reports %s without confusing failed delivery with cancellation', (outcome, text) => {
    const events = log([
      { type: 'operator-input-requested', requestId: 'input', description: 'Paste the document', path: '/tmp/input' },
      { type: 'operator-input-resolved', requestId: 'input', outcome, bytes: 12000 },
    ])
    const model = deriveTranscript({ events, signals: [] })
    expect(model.entries.filter((entry) => entry.kind === EEntryKind.OperatorInput).map((entry) => entry.text)).toEqual([
      'asks the operator: Paste the document',
      text,
    ])
  })
})
