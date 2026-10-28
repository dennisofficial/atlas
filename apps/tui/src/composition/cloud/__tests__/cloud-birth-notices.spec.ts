import { describe, expect, it } from 'bun:test'

import { EBirthFault, EBirthNode, type BirthFailure } from '@dltech/atlas-harness'

import { birthFailedNotice } from '../cloud-birth-notices'

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
  it('names the reason and the cause, and claims no fallback', () => {
    const text = birthFailedNotice(failure())

    expect(text).toBe('the pod would not start. vercel returned 500')
  })

  it('says the pod started but could not be attached when attach is what failed', () => {
    const text = birthFailedNotice(failure({ step: EBirthNode.Attach, detail: 'channel refused' }))

    expect(text).toContain('could not be attached')
    expect(text).toContain('channel refused')
  })

  it('never claims the thread moved or tells the operator to reconnect', () => {
    for (const step of EVERY_STEP) {
      for (const fault of EVERY_FAULT) {
        const text = birthFailedNotice(failure({ step, fault }))

        expect(text).not.toContain('moved to the cloud')
        expect(text).not.toContain('/container cloud')
        expect(text).not.toContain('reconnect')
        expect(text).not.toContain('still runs here')
        expect(text).not.toContain('this machine')
      }
    }
  })
})

describe('a pod image pull failure', () => {
  it('names the pull as the fault', () => {
    expect(
      birthFailedNotice(failure({ fault: EBirthFault.ImagePull, detail: 'denied' })),
    ).toContain('the pod image could not be pulled')
  })
})

describe('a birth the API says is not configured', () => {
  it('shows the API message under the not-set-up head', () => {
    const detail =
      'Atlas Cloud cannot start a sandbox for this account yet. Add your Vercel credentials in your Atlas Cloud settings, then try again.'

    expect(birthFailedNotice(failure({ fault: EBirthFault.NotConfigured, detail }))).toBe(
      `cloud sandboxes are not set up. ${detail}`,
    )
  })
})
