import { describe, expect, it } from 'bun:test'

import { EBirthFault, EBirthNode, type BirthFailure } from '@dltech/atlas-harness'

import { liftFailedNotice } from '../lift-notices'

const failure = (over: Partial<BirthFailure> = {}): BirthFailure => ({
  ok: false,
  fault: EBirthFault.Sandbox,
  step: EBirthNode.Provision,
  detail: 'vercel returned 500',
  ...over,
})

const EVERY_STEP = Object.values(EBirthNode)
const EVERY_FAULT = Object.values(EBirthFault)

describe('a failed cloud birth', () => {
  it('names the reason and says the thread started on this machine', () => {
    const text = liftFailedNotice(failure())

    expect(text).toContain('the sandbox would not start')
    expect(text).toContain('this thread started on this machine instead')
    expect(text).toContain('vercel returned 500')
  })

  it('says the sandbox started but could not be attached when attach is what failed', () => {
    const text = liftFailedNotice(failure({ step: EBirthNode.Attach, detail: 'channel refused' }))

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
    const text = liftFailedNotice(failure({ fault: EBirthFault.Transfer, step: EBirthNode.CaptureWorkspace, detail: 'archive is truncated' }))

    expect(text).toContain('workspace could not be captured')
    expect(text).toContain('archive is truncated')
  })
})
