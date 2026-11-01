import { describe, expect, it } from 'bun:test'

import {
  EAdmissionCompletion,
  EAvailabilityControl,
  ECredentialAvailability,
  CredentialAvailabilityPort,
  type AdmissionDecision,
} from '@dltech/atlas-core'

import { RemoteCredentialAvailability } from '../remote-credential-availability'
import {
  clientAnswering,
  key,
  probePermit,
  quotaFailure,
  revision,
  snapshotBody,
} from './availability-fixture'

const replyFor = (procedure: string) => {
  if (procedure.endsWith('admit')) return { data: { admitted: true, permit: probePermit } }
  if (procedure.endsWith('inspect') || procedure.endsWith('control')) {
    return { data: snapshotBody }
  }
  return { data: null }
}

describe('RemoteCredentialAvailability', () => {
  it('is a CredentialAvailabilityPort', () => {
    const { client } = clientAnswering((call) => replyFor(call.procedure))
    expect(new RemoteCredentialAvailability({ client })).toBeInstanceOf(CredentialAvailabilityPort)
  })

  it('maps each port method to its credentialAvailability procedure', async () => {
    const { client, calls } = clientAnswering((call) => replyFor(call.procedure))
    const port = new RemoteCredentialAvailability({ client })

    await port.inspect({ key, revision })
    await port.admit({ key, revision })
    await port.complete({
      permit: probePermit,
      completion: { outcome: EAdmissionCompletion.Succeeded },
    })
    await port.promoteProbe({ permit: probePermit, failure: quotaFailure })
    const control = await port.control({
      key,
      revision,
      action: EAvailabilityControl.Resume,
    })

    expect(calls.map((call) => call.procedure)).toEqual([
      'credentialAvailability.inspect',
      'credentialAvailability.admit',
      'credentialAvailability.complete',
      'credentialAvailability.promoteProbe',
      'credentialAvailability.control',
    ])
    expect(control.availability).toBe(ECredentialAvailability.QuotaExhausted)
  })

  it('carries the permitId returned by admit into complete and promoteProbe', async () => {
    const { client, calls } = clientAnswering((call) => replyFor(call.procedure))
    const port = new RemoteCredentialAvailability({ client })

    const decision: AdmissionDecision = await port.admit({ key, revision })
    if (!decision.admitted) throw new Error('expected admission')
    await port.promoteProbe({ permit: decision.permit, failure: quotaFailure })
    await port.complete({
      permit: decision.permit,
      completion: { outcome: EAdmissionCompletion.Cancelled },
    })

    const settled = calls.slice(1).map((call) => call.input as { permit: { permitId: string } })
    expect(settled.map((input) => input.permit.permitId)).toEqual([
      probePermit.permitId ?? '',
      probePermit.permitId ?? '',
    ])
  })
})
