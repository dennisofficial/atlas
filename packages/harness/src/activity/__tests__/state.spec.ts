import { describe, expect, it } from 'bun:test'

import { toCallId, toRunId } from '@dltech/atlas-core'

import { ETurnStatus } from '../../loop/turn-outcome'
import { createActivityTracker, activityOutcomeOf, type ActivityReport } from '../index'

const runId = toRunId('run-1')

const arrange = () => {
  const reports: ActivityReport[] = []
  const tracker = createActivityTracker({ report: (state) => reports.push(state) })
  return { reports, tracker }
}

describe('activity tracker', () => {
  it('holds completion behind background work and omits the outcome until idle', () => {
    const { tracker, reports } = arrange()
    tracker.turnStarted()
    tracker.setBackground(true)
    tracker.turnOutcome({ status: ETurnStatus.Completed, runId })
    expect(reports).toHaveLength(2)
    tracker.turnEnded()
    expect(reports.at(-1)).toEqual({ working: true, awaiting: null })
    expect(Object.hasOwn(reports.at(-1) ?? {}, 'lastOutcome')).toBe(false)
    tracker.setBackground(false)
    expect(reports.at(-1)).toEqual({ working: false, awaiting: null, lastOutcome: 'completed' })
  })

  it('assigns failures silently and clears them on the next start', () => {
    const { tracker, reports } = arrange()
    tracker.turnStarted()
    tracker.turnFailed()
    expect(reports).toHaveLength(1)
    tracker.turnEnded()
    expect(reports.at(-1)).toEqual({ working: false, awaiting: null, lastOutcome: 'failed' })
    tracker.turnStarted()
    tracker.turnEnded()
    expect(reports.at(-1)).toEqual({ working: false, awaiting: null })
  })

  it('does not emit for unchanged input, approval or background flags', () => {
    const { tracker, reports } = arrange()
    tracker.setInput(false)
    tracker.setApproval(false)
    tracker.setBackground(false)
    expect(reports).toEqual([])
    tracker.setInput(true)
    tracker.setInput(true)
    expect(reports).toEqual([{ working: false, awaiting: 'input' }])
  })

  it('maps all six genuine turn outcomes without inventing terminal outcomes', () => {
    expect([
      activityOutcomeOf({ status: ETurnStatus.Completed, runId }),
      activityOutcomeOf({ status: ETurnStatus.Failed, runId, message: 'x', cause: null }),
      activityOutcomeOf({ status: ETurnStatus.Interrupted, runId, committed: false }),
      activityOutcomeOf({
        status: ETurnStatus.Paused,
        runId,
        callId: toCallId('call-1'),
        reason: 'r',
      }),
      activityOutcomeOf({ status: ETurnStatus.Idle, runId }),
      activityOutcomeOf({ status: ETurnStatus.RelocationPaused, runId }),
    ]).toEqual(['completed', 'failed', 'stopped', undefined, undefined, undefined])
  })

  it('reports start, approval, input precedence and completion in order', () => {
    const { tracker, reports } = arrange()
    tracker.turnStarted()
    tracker.setApproval(true)
    tracker.setInput(true)
    tracker.setInput(false)
    tracker.setApproval(false)
    tracker.turnOutcome({ status: ETurnStatus.Completed, runId })
    expect(reports).toHaveLength(5)
    tracker.turnEnded()
    expect(reports).toEqual([
      { working: true, awaiting: null },
      { working: true, awaiting: 'approval' },
      { working: true, awaiting: 'input' },
      { working: true, awaiting: 'approval' },
      { working: true, awaiting: null },
      { working: false, awaiting: null, lastOutcome: 'completed' },
    ])
  })
})
