import { describe, expect, it } from 'bun:test'

import {
  EAdmissionCompletion,
  ECredentialAvailability,
  EAvailabilityControl,
  EProviderFailureKind,
} from '@dltech/atlas-core'

import { ModelAdmissionBlockedError } from '../admission-blocked'
import {
  closeBarrier,
  generated,
  harness,
  key,
  quotaFault,
  revision,
} from './admitted-model-fixture'

describe('admittedModel', () => {
  it('delegates identity straight through', () => {
    const rig = harness({})
    expect(rig.admitted.provider).toBe(key.providerId)
    expect(rig.admitted.modelId).toBe(key.modelId)
  })

  it('completes Succeeded after a successful generation', async () => {
    const rig = harness({})

    expect(await rig.admitted.doGenerate({ prompt: [] })).toBe(generated)
    expect(rig.availability.completions).toEqual([{ outcome: EAdmissionCompletion.Succeeded }])
  })

  it('throws the typed error without dispatching when the barrier is closed and a probe is in flight', async () => {
    const rig = harness({})
    await closeBarrier(rig)
    await rig.availability.admit({ key, revision })

    const attempt = rig.admitted.doGenerate({ prompt: [] })

    await expect(attempt).rejects.toBeInstanceOf(ModelAdmissionBlockedError)
    expect(rig.dispatched).toHaveLength(0)
  })

  it('blocks a paused credential on stream dispatch too', async () => {
    const rig = harness({})
    await rig.availability.control({ key, revision, action: EAvailabilityControl.Pause })

    const attempt = rig.admitted.doStream({ prompt: [] })

    await expect(attempt).rejects.toMatchObject({
      block: { snapshot: { availability: ECredentialAvailability.Paused } },
    })
    expect(rig.dispatched).toHaveLength(0)
  })

  it('classifies a thrown provider failure, closes the barrier and rethrows', async () => {
    const fault = quotaFault()
    const rig = harness({ doGenerate: async () => Promise.reject(fault) })

    await expect(rig.admitted.doGenerate({ prompt: [] })).rejects.toBe(fault)

    expect(rig.availability.completions[0]).toMatchObject({
      outcome: EAdmissionCompletion.Failed,
      failure: { kind: EProviderFailureKind.Quota, accountId: key.accountId },
    })
    expect((await rig.availability.inspect({ key, revision })).availability).toBe(
      ECredentialAvailability.QuotaExhausted,
    )
  })

  it('promotes a probe that throws instead of completing it', async () => {
    const rig = harness({ doGenerate: async () => Promise.reject(quotaFault()) })
    await closeBarrier(rig)

    await expect(rig.admitted.doGenerate({ prompt: [] })).rejects.toBeDefined()

    expect(rig.availability.promotions).toHaveLength(1)
    expect(rig.availability.completions).toHaveLength(0)
  })

  it('completes Cancelled when a dispatch fails under an aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const rig = harness({ doGenerate: async () => Promise.reject(new Error('aborted')) })

    await expect(
      rig.admitted.doGenerate({ prompt: [], abortSignal: controller.signal }),
    ).rejects.toBeDefined()

    expect(rig.availability.completions).toEqual([{ outcome: EAdmissionCompletion.Cancelled }])
  })
})
