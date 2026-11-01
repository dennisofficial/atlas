import { describe, expect, it } from 'bun:test'

import {
  admissionCompletionSchema,
  admissionDecisionSchema,
  admissionPermitSchema,
  admitAvailabilityInputSchema,
  availabilityKeySchema,
  completeAvailabilityInputSchema,
  controlAvailabilityInputSchema,
  EAdmissionCompletion,
  EAvailabilityControl,
  ECredentialAvailability,
  ECredentialFence,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  promoteProbeInputSchema,
} from '../credential-availability-wire'

const key = { accountId: 'acc', providerId: 'anthropic', modelId: 'claude' }
const revision = { fence: ECredentialFence.Replaced, value: 0 }
const permit = {
  key,
  revision,
  probe: true,
  admittedAt: '2026-11-01T00:00:00.000Z',
  permitId: '6f1c0f3e-0000-4000-8000-000000000000',
}
const failure = {
  kind: EProviderFailureKind.Quota,
  scope: EProviderFailureScope.Credential,
  retry: EProviderRetry.Never,
  message: 'quota',
}

describe('credential availability wire', () => {
  it('requires a permitId on the permit', () => {
    expect(admissionPermitSchema.parse(permit).permitId).toBe(permit.permitId)
    const { permitId: _omitted, ...bare } = permit
    expect(admissionPermitSchema.safeParse(bare).success).toBe(false)
  })

  it('caps identifier lengths', () => {
    expect(availabilityKeySchema.safeParse({ ...key, accountId: 'a'.repeat(257) }).success).toBe(
      false,
    )
    expect(availabilityKeySchema.safeParse({ ...key, providerId: 'p'.repeat(257) }).success).toBe(
      false,
    )
    expect(availabilityKeySchema.safeParse({ ...key, modelId: 'm'.repeat(512) }).success).toBe(true)
    expect(availabilityKeySchema.safeParse({ ...key, modelId: 'm'.repeat(513) }).success).toBe(
      false,
    )
  })

  it('discriminates completions on outcome', () => {
    expect(
      admissionCompletionSchema.parse({
        outcome: EAdmissionCompletion.Succeeded,
      }),
    ).toEqual({
      outcome: EAdmissionCompletion.Succeeded,
    })
    expect(
      admissionCompletionSchema.safeParse({
        outcome: EAdmissionCompletion.Failed,
      }).success,
    ).toBe(false)
    expect(
      admissionCompletionSchema.parse({
        outcome: EAdmissionCompletion.Failed,
        failure,
      }).outcome,
    ).toBe(EAdmissionCompletion.Failed)
    expect(
      admissionCompletionSchema.parse({
        outcome: EAdmissionCompletion.Cancelled,
      }).outcome,
    ).toBe(EAdmissionCompletion.Cancelled)
  })

  it('discriminates decisions on admitted', () => {
    expect(admissionDecisionSchema.parse({ admitted: true, permit }).admitted).toBe(true)
    const snapshot = {
      key,
      availability: ECredentialAvailability.Paused,
      revision,
      since: '2026-11-01T00:00:00.000Z',
    }
    expect(
      admissionDecisionSchema.parse({
        admitted: false,
        block: { key, snapshot },
      }).admitted,
    ).toBe(false)
  })

  it('rejects unknown fields on every input', () => {
    expect(admitAvailabilityInputSchema.safeParse({ key, revision, userId: 'x' }).success).toBe(
      false,
    )
    expect(
      completeAvailabilityInputSchema.safeParse({
        permit,
        completion: { outcome: EAdmissionCompletion.Succeeded },
        userId: 'x',
      }).success,
    ).toBe(false)
    expect(promoteProbeInputSchema.safeParse({ permit, failure, extra: 1 }).success).toBe(false)
    expect(
      controlAvailabilityInputSchema.safeParse({
        key,
        revision,
        action: EAvailabilityControl.Pause,
        userId: 'x',
      }).success,
    ).toBe(false)
  })
})
