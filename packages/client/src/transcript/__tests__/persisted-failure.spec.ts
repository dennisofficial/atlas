import { describe, expect, it } from 'bun:test'

import { ERunFailureKind } from '@dltech/atlas-core'

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
      failure: null,
      runId: null,
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
    expect(model.failure).toEqual({ message: null, failure: null, runId: null })
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

  it('shows no failure for a live Failed step once the durable failure is dismissed', () => {
    const events = log([
      { type: 'user-said', text: 'go' },
      { type: 'run-failed', failure: { kind: ERunFailureKind.Auth, message: 'bad' } },
      { type: 'run-failure-dismissed', failureSeq: 2 },
    ])
    const model = deriveTranscript({
      events,
      signals: [
        started(stepOne),
        ended({ stepId: stepOne, end: EStepEnd.Failed, supersededBy: null }),
      ],
    })
    expect(model.failure).toBeNull()
  })
})
