import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { createSignedInApiPodBridge, SIGN_IN_FOR_PODS_MESSAGE } from '../api-pod-signed-in'
import { CloudError } from '../cloud-transport'
import { ECloudSandboxState } from '../sandbox-client'
import type { CloudSession } from '../cloud-session'

const THREAD = toThreadId('thr_signed')

type Seen = { url: string; authorization: string | null; version: string | null }

const scriptedFetch = (): { fetchFn: typeof fetch; seen: Seen[] } => {
  const seen: Seen[] = []
  const fetchFn = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const url = input instanceof Request ? input.url : String(input)
      seen.push({
        url,
        authorization: headers.get('authorization'),
        version: headers.get('atlas-client-version'),
      })
      const data = url.includes('sandboxCheckpoint.get')
        ? { checkpoint: null }
        : { state: 'parked', steps: [] }
      return Response.json({ result: { data } })
    },
    { preconnect: fetch.preconnect },
  )
  return { fetchFn, seen }
}

const sessionOf = (token: string): CloudSession => ({
  url: 'https://cloud.test',
  token,
  email: null,
})

describe('createSignedInApiPodBridge', () => {
  it('talks to the signed-in session url with its bearer token and client version', async () => {
    const { fetchFn, seen } = scriptedFetch()
    const bridge = createSignedInApiPodBridge({
      session: () => sessionOf('tok-1'),
      clientVersion: '1.2.3',
      fetchFn,
    })

    const found = await bridge.sandboxes.find({ threadId: THREAD })

    expect(found?.state).toBe(ECloudSandboxState.Parked)
    expect(seen.length).toBeGreaterThan(0)
    for (const call of seen) {
      expect(call.url.startsWith('https://cloud.test/v1/trpc/')).toBe(true)
      expect(call.authorization).toBe('Bearer tok-1')
      expect(call.version).toBe('1.2.3')
    }
  })

  it('reads the session on every call, so a re-login takes effect without a new bridge', async () => {
    const { fetchFn, seen } = scriptedFetch()
    let token = 'before'
    const bridge = createSignedInApiPodBridge({
      session: () => sessionOf(token),
      clientVersion: '1.2.3',
      fetchFn,
    })

    await bridge.sandboxes.find({ threadId: THREAD })
    token = 'after'
    await bridge.sandboxes.find({ threadId: THREAD })

    expect(new Set(seen.map((call) => call.authorization))).toEqual(
      new Set(['Bearer before', 'Bearer after']),
    )
  })

  it('refuses while signed out, naming the sign-in', async () => {
    const { fetchFn, seen } = scriptedFetch()
    const bridge = createSignedInApiPodBridge({
      session: () => null,
      clientVersion: '1.2.3',
      fetchFn,
    })

    const failure = await bridge.sandboxes
      .find({ threadId: THREAD })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).message).toBe(SIGN_IN_FOR_PODS_MESSAGE)
    expect(seen).toEqual([])
  })
})
