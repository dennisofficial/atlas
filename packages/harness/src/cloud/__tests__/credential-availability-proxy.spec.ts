import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAdmissionCompletion,
  type AdmissionDecision,
  type AdmissionPermit,
  type ClockPort,
} from '@dltech/atlas-core'

import { InMemoryCredentialAvailability } from '../../credentials/credential-availability'
import { CredentialAvailabilityProxy } from '../credential-availability-proxy'
import { CloudSessionStore } from '../cloud-session'
import { isTrpcUrl, trpcCallOf, trpcData } from './accounts-trpc-fake'
import { key, probePermit, revision } from './availability-fixture'

const clock: ClockPort = { now: () => '2026-11-01T12:00:00.000Z' }

let directory: string
let sessions: CloudSessionStore
let local: InMemoryCredentialAvailability
let proxy: CredentialAvailabilityProxy
let remoteCalls: { procedure: string; authorization: string | null }[]
const realFetch = globalThis.fetch

const permitOf = (decision: AdmissionDecision): AdmissionPermit => {
  if (!decision.admitted) throw new Error('expected admission')
  return decision.permit
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-availability-proxy-'))
  sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  local = new InMemoryCredentialAvailability({ clock })
  proxy = new CredentialAvailabilityProxy({
    local,
    session: () => sessions.read(),
  })
  remoteCalls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (!isTrpcUrl(url)) return new Response('nf', { status: 404 })
    const { procedure } = trpcCallOf({ url })
    remoteCalls.push({
      procedure,
      authorization: new Headers(init?.headers).get('authorization'),
    })
    return trpcData(procedure.endsWith('admit') ? { admitted: true, permit: probePermit } : null)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  rmSync(directory, { recursive: true, force: true })
})

describe('CredentialAvailabilityProxy', () => {
  it('serves from the in-memory authority when signed out, with no network', async () => {
    const permit = permitOf(await proxy.admit({ key, revision }))
    await proxy.complete({
      permit,
      completion: { outcome: EAdmissionCompletion.Succeeded },
    })

    expect(permit.permitId).toBeUndefined()
    expect(remoteCalls).toEqual([])
  })

  it('serves from the remote authority when a cloud session exists', async () => {
    sessions.write({ url: 'http://cloud.test', token: 'tok-1', email: null })

    const permit = permitOf(await proxy.admit({ key, revision }))
    await proxy.complete({
      permit,
      completion: { outcome: EAdmissionCompletion.Succeeded },
    })

    expect(permit.permitId).toBe(probePermit.permitId)
    expect(remoteCalls).toEqual([
      {
        procedure: 'credentialAvailability.admit',
        authorization: 'Bearer tok-1',
      },
      {
        procedure: 'credentialAvailability.complete',
        authorization: 'Bearer tok-1',
      },
    ])
  })

  it('switches back to in-memory when the session is cleared', async () => {
    sessions.write({ url: 'http://cloud.test', token: 'tok-1', email: null })
    await proxy.admit({ key, revision })
    sessions.clear()

    const permit = permitOf(await proxy.admit({ key, revision }))

    expect(permit.permitId).toBeUndefined()
    expect(remoteCalls).toHaveLength(1)
  })

  it('settles a local permit locally even after a session appears', async () => {
    const permit = permitOf(await proxy.admit({ key, revision }))
    sessions.write({ url: 'http://cloud.test', token: 'tok-1', email: null })

    await proxy.complete({
      permit,
      completion: { outcome: EAdmissionCompletion.Succeeded },
    })

    expect(remoteCalls).toEqual([])
  })

  it('drops a remote permit settlement when the session ended mid-flight', async () => {
    sessions.write({ url: 'http://cloud.test', token: 'tok-1', email: null })
    const permit = permitOf(await proxy.admit({ key, revision }))
    sessions.clear()

    await proxy.complete({
      permit,
      completion: { outcome: EAdmissionCompletion.Succeeded },
    })

    expect(remoteCalls.map((call) => call.procedure)).toEqual(['credentialAvailability.admit'])
  })

  it('rebuilds the remote client when the token changes', async () => {
    sessions.write({ url: 'http://cloud.test', token: 'tok-1', email: null })
    await proxy.admit({ key, revision })
    sessions.write({ url: 'http://cloud.test', token: 'tok-2', email: null })
    await proxy.admit({ key, revision })

    expect(remoteCalls.map((call) => call.authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2'])
  })
})
