import { describe, expect, it } from 'bun:test'

import {
  ECredentialAvailability,
  EAdmissionCompletion,
  EAvailabilityControl,
} from '@dltech/atlas-core'

import { CloudError } from '../cloud-client'
import { MissingPermitIdError } from '../availability-dto'
import {
  PERMIT_ID,
  clientAnswering,
  key,
  probePermit,
  quotaFailure,
  revision,
  snapshotBody,
} from './availability-fixture'

describe('CloudClient availability methods', () => {
  it('inspects through the wire schema and returns a core snapshot', async () => {
    const { client, calls } = clientAnswering(() => ({ data: snapshotBody }))

    const snapshot = await client.inspectAvailability({ key, revision })

    expect(calls).toEqual([
      { procedure: 'credentialAvailability.inspect', input: { key, revision } },
    ])
    expect(snapshot).toEqual(snapshotBody)
  })

  it('admit returns the server permit with its permitId', async () => {
    const { client, calls } = clientAnswering(() => ({
      data: { admitted: true, permit: probePermit },
    }))

    const decision = await client.admitAvailability({ key, revision })

    expect(calls[0]).toEqual({
      procedure: 'credentialAvailability.admit',
      input: { key, revision },
    })
    expect(decision).toEqual({ admitted: true, permit: probePermit })
  })

  it('admit maps a block to a core block', async () => {
    const { client } = clientAnswering(() => ({
      data: { admitted: false, block: { key, snapshot: snapshotBody } },
    }))

    const decision = await client.admitAvailability({ key, revision })

    expect(decision).toEqual({
      admitted: false,
      block: { key, snapshot: snapshotBody },
    })
  })

  it('rejects a server admit reply that carries no permitId', async () => {
    const { permitId: _omitted, ...bare } = probePermit
    const { client } = clientAnswering(() => ({
      data: { admitted: true, permit: bare },
    }))

    await expect(client.admitAvailability({ key, revision })).rejects.toBeDefined()
  })

  it('complete sends the permit including permitId and the completion', async () => {
    const { client, calls } = clientAnswering(() => ({ data: null }))

    await client.completeAvailability({
      permit: probePermit,
      completion: {
        outcome: EAdmissionCompletion.Failed,
        failure: quotaFailure,
      },
    })

    expect(calls).toEqual([
      {
        procedure: 'credentialAvailability.complete',
        input: {
          permit: probePermit,
          completion: {
            outcome: EAdmissionCompletion.Failed,
            failure: quotaFailure,
          },
        },
      },
    ])
    expect(JSON.stringify(calls[0]?.input)).toContain(PERMIT_ID)
  })

  it('promoteProbe sends the permit and failure', async () => {
    const { client, calls } = clientAnswering(() => ({ data: null }))

    await client.promoteProbeAvailability({
      permit: probePermit,
      failure: quotaFailure,
    })

    expect(calls).toEqual([
      {
        procedure: 'credentialAvailability.promoteProbe',
        input: { permit: probePermit, failure: quotaFailure },
      },
    ])
  })

  it('control sends the action and returns the snapshot', async () => {
    const paused = {
      ...snapshotBody,
      availability: ECredentialAvailability.Paused,
    }
    const { client, calls } = clientAnswering(() => ({ data: paused }))

    const snapshot = await client.controlAvailability({
      key,
      revision,
      action: EAvailabilityControl.Pause,
    })

    expect(calls[0]).toEqual({
      procedure: 'credentialAvailability.control',
      input: { key, revision, action: EAvailabilityControl.Pause },
    })
    expect(snapshot.availability).toBe(ECredentialAvailability.Paused)
  })

  it('refuses to settle a permit that has no permitId, without calling the API', async () => {
    const { client, calls } = clientAnswering(() => ({ data: null }))
    const { permitId: _omitted, ...local } = probePermit

    await expect(
      client.completeAvailability({
        permit: local,
        completion: { outcome: EAdmissionCompletion.Succeeded },
      }),
    ).rejects.toBeInstanceOf(MissingPermitIdError)
    expect(calls).toEqual([])
  })

  it('truncates an oversized failure message to the wire cap', async () => {
    const { client, calls } = clientAnswering(() => ({ data: null }))

    await client.promoteProbeAvailability({
      permit: probePermit,
      failure: { ...quotaFailure, message: 'x'.repeat(20_000) },
    })

    const sent = calls[0]?.input as { failure: { message: string } }
    expect(sent.failure.message).toHaveLength(16_384)
  })

  it('surfaces an API failure as a CloudError', async () => {
    const { client } = clientAnswering(() => ({
      status: 401,
      message: 'nope',
    }))

    await expect(client.admitAvailability({ key, revision })).rejects.toBeInstanceOf(CloudError)
  })
})
