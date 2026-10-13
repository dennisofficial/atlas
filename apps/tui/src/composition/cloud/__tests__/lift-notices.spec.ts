import { describe, expect, it } from 'bun:test'

import { ELiftFault, ELiftStep, NOTHING_WAS_STOPPED, type LiftFailure } from '@dltech/atlas-harness'

import { liftFailedNotice } from '../lift-notices'

const failure = (over: Partial<LiftFailure> = {}): LiftFailure => ({
  ok: false,
  fault: ELiftFault.Sandbox,
  step: ELiftStep.Starting,
  detail: 'vercel returned 500',
  stopped: NOTHING_WAS_STOPPED,
  ...over,
})

const EVERY_STEP = Object.values(ELiftStep)
const EVERY_FAULT = Object.values(ELiftFault)

describe('a failed cloud birth', () => {
  it('names the reason and says the thread started on this machine', () => {
    const text = liftFailedNotice(failure())

    expect(text).toContain('the sandbox would not start')
    expect(text).toContain('this thread started on this machine instead')
    expect(text).toContain('vercel returned 500')
  })

  it('says the sandbox started but could not be attached when attach is what failed', () => {
    const text = liftFailedNotice(failure({ step: ELiftStep.Attaching, detail: 'channel refused' }))

    expect(text).toContain('could not be attached')
    expect(text).toContain('this thread started on this machine instead')
    expect(text).toContain('channel refused')
  })

  it('never claims the thread moved or tells the operator to reconnect', () => {
    for (const step of EVERY_STEP) {
      for (const fault of EVERY_FAULT) {
        const text = liftFailedNotice(failure({ step, fault }))

        expect(text).not.toContain('moved to the cloud')
        expect(text).not.toContain('/container cloud')
        expect(text).not.toContain('reconnect')
        expect(text).not.toContain('still runs here')
        expect(text).toContain('this machine')
      }
    }
  })

  it('names the capture failure as the workspace, not a conversation transfer', () => {
    const text = liftFailedNotice(failure({ fault: ELiftFault.Transfer, step: ELiftStep.Capturing, detail: 'archive is truncated' }))

    expect(text).toContain('workspace could not be captured')
    expect(text).toContain('archive is truncated')
  })
})
