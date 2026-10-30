import { describe, expect, it } from 'bun:test'

import { EStepEnd } from '../../channel'

import { deriveTranscript } from '../derive-transcript'
import { ended, log, started, stepOne } from './fixture'

const failedTurn = () =>
  log([
    { type: 'user-said', text: 'go' },
    { type: 'turn-failed', message: 'InvalidApiKey' },
  ])

describe('a persisted failed turn', () => {
  it('renders as the failure with no live signals attached', () => {
    expect(deriveTranscript({ events: failedTurn(), signals: [] }).failure).toEqual({
      message: 'InvalidApiKey',
    })
  })

  it('is superseded by the live failure rather than shown twice', () => {
    const model = deriveTranscript({
      events: failedTurn(),
      signals: [
        started(stepOne),
        ended({ stepId: stepOne, end: EStepEnd.Failed, supersededBy: null }),
      ],
    })

    expect(model.failure).not.toBeNull()
    expect(model.failure).toEqual({ message: null })
  })

  it('clears once the operator speaks again', () => {
    const events = log([
      { type: 'turn-failed', message: 'InvalidApiKey' },
      { type: 'user-said', text: 'retry' },
    ])

    expect(deriveTranscript({ events, signals: [] }).failure).toBeNull()
  })

  it('is hidden while a retry is working', () => {
    const model = deriveTranscript({
      events: failedTurn(),
      signals: [started(stepOne)],
    })

    expect(model.failure).toBeNull()
  })
})
