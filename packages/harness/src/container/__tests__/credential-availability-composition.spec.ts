import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  CredentialAvailabilityPort,
  ECredentialFence,
  toAccountId,
  type AdmissionDecision,
  type AvailabilityKey,
  type CredentialRevision,
} from '@dltech/atlas-core'

import { createHarnessContainer } from '../create-harness-container'
import { disposeAll } from '../disposal'
import { registeredPortToken, type DependencyContainer } from '../injection'
import { ServeSessionToken } from '../tokens'

const key: AvailabilityKey = {
  accountId: toAccountId('acct_1'),
  providerId: 'anthropic',
  modelId: 'claude-opus-5',
}
const revision: CredentialRevision = {
  fence: ECredentialFence.Replaced,
  value: 1,
}
const SERVER_PERMIT_ID = 'server-permit-1'

const realFetch = globalThis.fetch
let calls: { url: string; authorization: string | null }[]
let container: DependencyContainer

beforeEach(() => {
  calls = []
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
      })
      return Response.json({
        result: {
          data: {
            admitted: true,
            permit: {
              key,
              revision,
              probe: false,
              admittedAt: '2026-11-01T12:00:00.000Z',
              permitId: SERVER_PERMIT_ID,
            },
          },
        },
      })
    },
    { preconnect: () => undefined },
  )
  container = createHarnessContainer()
})

afterEach(async () => {
  globalThis.fetch = realFetch
  await disposeAll({ container })
})

const admitted = async (): Promise<AdmissionDecision> =>
  container.resolve(registeredPortToken(CredentialAvailabilityPort)).admit({ key, revision })

describe('credential availability composition', () => {
  it('resolves the in-memory authority for a signed-out local session', async () => {
    const decision = await admitted()

    if (!decision.admitted) throw new Error('expected admission')
    expect(decision.permit.permitId).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('resolves the durable remote authority for a serve session', async () => {
    container.register(ServeSessionToken, {
      useValue: {
        url: 'https://api.test',
        token: 'sandbox-principal',
        email: null,
      },
    })

    const decision = await admitted()

    if (!decision.admitted) throw new Error('expected admission')
    expect(decision.permit.permitId).toBe(SERVER_PERMIT_ID)
    expect(calls).toEqual([
      {
        url: 'https://api.test/v1/trpc/credentialAvailability.admit',
        authorization: 'Bearer sandbox-principal',
      },
    ])
  })
})
