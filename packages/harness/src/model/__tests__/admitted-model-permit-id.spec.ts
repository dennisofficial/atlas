import { describe, expect, it } from 'bun:test'

import { EAdmissionCompletion, type AdmissionPermit, type ClockPort } from '@dltech/atlas-core'

import { InMemoryCredentialAvailability } from '../../credentials/credential-availability'
import { admittedModel } from '../admitted-model'
import { START_MS, generated, key, quotaFault, revision } from './admitted-model-fixture'

const PERMIT_ID = 'server-permit-1'

class ServerIssuedAvailability extends InMemoryCredentialAvailability {
  readonly completed: AdmissionPermit[] = []
  readonly promoted: AdmissionPermit[] = []

  override async admit(args: Parameters<InMemoryCredentialAvailability['admit']>[0]) {
    const decision = await super.admit(args)
    if (!decision.admitted) return decision
    return {
      admitted: true as const,
      permit: { ...decision.permit, permitId: PERMIT_ID },
    }
  }

  override async complete(args: Parameters<InMemoryCredentialAvailability['complete']>[0]) {
    this.completed.push(args.permit)
    await super.complete(args)
  }

  override async promoteProbe(args: Parameters<InMemoryCredentialAvailability['promoteProbe']>[0]) {
    this.promoted.push(args.permit)
    await super.promoteProbe(args)
  }
}

const rigFor = (doGenerate: () => Promise<typeof generated>) => {
  const clock: ClockPort = { now: () => new Date(START_MS).toISOString() }
  const availability = new ServerIssuedAvailability({ clock })
  const model = admittedModel({
    model: {
      specificationVersion: 'v4',
      provider: key.providerId,
      modelId: key.modelId,
      supportedUrls: {},
      doGenerate,
      doStream: async () => ({ stream: new ReadableStream() }),
    },
    key,
    revision: async () => revision,
    availability,
    clock,
  })
  return { availability, model }
}

describe('admittedModel permit identity', () => {
  it('passes a permitId-bearing permit through to complete unchanged', async () => {
    const rig = rigFor(async () => generated)

    await rig.model.doGenerate({ prompt: [] })

    expect(rig.availability.completed).toHaveLength(1)
    expect(rig.availability.completed[0]?.permitId).toBe(PERMIT_ID)
  })

  it('passes a permitId-bearing probe permit through to promoteProbe unchanged', async () => {
    const rig = rigFor(() => Promise.reject(quotaFault()))
    await expect(rig.model.doGenerate({ prompt: [] })).rejects.toBeDefined()
    expect(rig.availability.completed[0]?.permitId).toBe(PERMIT_ID)
    expect(rig.availability.completed[0]?.probe).toBe(false)

    await expect(rig.model.doGenerate({ prompt: [] })).rejects.toBeDefined()

    expect(rig.availability.promoted).toHaveLength(1)
    expect(rig.availability.promoted[0]?.probe).toBe(true)
    expect(rig.availability.promoted[0]?.permitId).toBe(PERMIT_ID)
  })

  it('leaves permitId undefined under the in-memory authority', async () => {
    const clock: ClockPort = { now: () => new Date(START_MS).toISOString() }
    const availability = new InMemoryCredentialAvailability({ clock })

    const decision = await availability.admit({ key, revision })

    if (!decision.admitted) throw new Error('expected admission')
    expect(decision.permit.permitId).toBeUndefined()
    await availability.complete({
      permit: decision.permit,
      completion: { outcome: EAdmissionCompletion.Succeeded },
    })
  })
})
