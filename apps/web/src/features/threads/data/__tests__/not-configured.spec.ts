import { describe, expect, it } from 'bun:test'

import {
  EBootStep,
  EBootStepState,
  EPodState,
  EVercelCredentialGap,
  type PodStatus,
  type RecordedBootStep,
} from '@dltech/atlas-wire/web'

import { NOT_CONFIGURED_FALLBACK, notConfiguredOf } from '../not-configured'

const step = (args: {
  step?: EBootStep
  state: EBootStepState
  at: string
  error?: string
  gap?: EVercelCredentialGap
}): RecordedBootStep => ({
  step: args.step ?? EBootStep.Provision,
  state: args.state,
  at: args.at,
  ...(args.error === undefined ? {} : { error: args.error }),
  ...(args.gap === undefined ? {} : { gap: args.gap }),
})

const pod = (state: EPodState, steps: RecordedBootStep[]): PodStatus => ({ state, steps })

const GAP_AT = '2026-10-22T10:00:01.000Z'
const gapFailed = step({
  state: EBootStepState.Error,
  at: GAP_AT,
  error: 'Add a Vercel token',
  gap: EVercelCredentialGap.UserCredential,
})

describe('notConfiguredOf', () => {
  it('is null before the pod loads and for a pod that did not fail', () => {
    expect(notConfiguredOf(null)).toBeNull()
    expect(notConfiguredOf(pod(EPodState.None, []))).toBeNull()
    expect(notConfiguredOf(pod(EPodState.Booting, []))).toBeNull()
    expect(notConfiguredOf(pod(EPodState.Parked, []))).toBeNull()
  })

  it('reads the error and gap from the failed Provision step, so it survives a reload', () => {
    expect(notConfiguredOf(pod(EPodState.Failed, [gapFailed]))).toEqual({
      error: 'Add a Vercel token',
      gap: EVercelCredentialGap.UserCredential,
    })
  })

  it('falls back to a generic message when the step carries no error text', () => {
    const bare = step({
      state: EBootStepState.Error,
      at: GAP_AT,
      gap: EVercelCredentialGap.UserCredential,
    })
    expect(notConfiguredOf(pod(EPodState.Failed, [bare]))).toEqual({
      error: NOT_CONFIGURED_FALLBACK,
      gap: EVercelCredentialGap.UserCredential,
    })
  })

  it('is null for a failure with no credential gap, such as a sandbox that would not start', () => {
    const plain = step({ state: EBootStepState.Error, at: GAP_AT, error: 'boom' })
    expect(notConfiguredOf(pod(EPodState.Failed, [plain]))).toBeNull()
  })

  it('ignores gaps on steps other than Provision', () => {
    const other = step({
      step: EBootStep.Serve,
      state: EBootStepState.Error,
      at: GAP_AT,
      error: 'x',
      gap: EVercelCredentialGap.UserCredential,
    })
    expect(notConfiguredOf(pod(EPodState.Failed, [other]))).toBeNull()
  })

  it('uses the latest Provision step, so a later attempt clears an earlier gap', () => {
    const retry = step({ state: EBootStepState.Running, at: '2026-10-22T10:05:00.000Z' })
    expect(notConfiguredOf(pod(EPodState.Failed, [gapFailed, retry]))).toBeNull()
    expect(notConfiguredOf(pod(EPodState.Booting, [gapFailed, retry]))).toBeNull()
  })

  it('finds the latest step by time, not by array order', () => {
    const early = step({ state: EBootStepState.Running, at: '2026-10-22T09:00:00.000Z' })
    expect(notConfiguredOf(pod(EPodState.Failed, [gapFailed, early]))).toEqual({
      error: 'Add a Vercel token',
      gap: EVercelCredentialGap.UserCredential,
    })
  })
})
