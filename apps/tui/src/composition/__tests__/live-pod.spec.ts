import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { atlasDirectory, type OrphanPodSweep } from '@dltech/atlas-harness'

import { fakeApp, fakeCloud, fakeSignedOutCloud, scriptedModelPort } from './fake-app'
import { cloudUrlOf } from '../live-cloud'
import {
  dockerRefusal,
  liveBirthPreflightFor,
  livePodBridgeOptionsFor,
  podReapFailureNotice,
  reapOrphanPodsWith,
} from '../live-pod'
import { ERunner } from '@dltech/atlas-core'

const model = scriptedModelPort({ script: { thinking: '', reply: 'ok' } })
const previousSocket = process.env.ATLAS_DOCKER_SOCKET

afterEach(() => {
  if (previousSocket === undefined) delete process.env.ATLAS_DOCKER_SOCKET
  else process.env.ATLAS_DOCKER_SOCKET = previousSocket
})

describe('livePodBridgeOptionsFor', () => {
  it('describes the pod from the cloud url, this home and the host arch', () => {
    const app = fakeApp({ model })
    const config = livePodBridgeOptionsFor(app).pod()

    expect(config.cloudUrl).toBe(cloudUrlOf(app))
    expect(config.home).toBe(atlasDirectory())
    expect(config.image).toBeUndefined()
  })

  it('leases the pod token to PUT /v1/pod-leases/:id with the session bearer', async () => {
    const seen: { method: string; path: string; auth: string | null; body: unknown }[] = []
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        seen.push({
          method: request.method,
          path: new URL(request.url).pathname,
          auth: request.headers.get('authorization'),
          body: await request.json(),
        })
        return new Response(null, { status: 204 })
      },
    })
    try {
      const app = fakeApp({
        model,
        cloud: fakeCloud({ session: { url: `http://127.0.0.1:${server.port}`, token: 'sess', email: null } }),
      })

      await livePodBridgeOptionsFor(app).registerPodLease({ threadId: toThreadId('brn_lease'), token: 'pod-token' })

      expect(seen).toEqual([
        { method: 'PUT', path: '/v1/pod-leases/brn_lease', auth: 'Bearer sess', body: { token: 'pod-token' } },
      ])
    } finally {
      await server.stop(true)
    }
  })

  it('refuses to lease while signed out', () => {
    const app = fakeApp({ model, cloud: fakeSignedOutCloud() })

    expect(() =>
      livePodBridgeOptionsFor(app).registerPodLease({ threadId: toThreadId('brn_lease'), token: 't' }),
    ).toThrow('sign in to Atlas Cloud')
  })
})

describe('the pod birth preflight', () => {
  it('names Docker Desktop and the socket when nothing answers', async () => {
    process.env.ATLAS_DOCKER_SOCKET = '/nonexistent/atlas-docker.sock'

    const refusal = await liveBirthPreflightFor(fakeApp({ model }))({ runner: ERunner.Local })

    expect(refusal).toContain('/nonexistent/atlas-docker.sock')
    expect(refusal).toContain('start Docker Desktop')
    expect(await dockerRefusal()).toBe(refusal)
  })
})

const sweepWith = (failures: OrphanPodSweep['failures']): OrphanPodSweep => ({ reaped: [], kept: [], failures })

describe('the orphan pod reaper at boot', () => {
  it('posts one notice naming the count and the first failure', async () => {
    const notices: string[] = []

    await reapOrphanPodsWith({
      reap: async () =>
        sweepWith([
          { name: 'atlas-pod-a', error: new Error('busy') },
          { name: 'atlas-pod-b', error: new Error('gone') },
        ]),
      notify: (text) => notices.push(text),
    })

    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('2 orphaned pods')
    expect(notices[0]).toContain('busy')
  })

  it('stays quiet when nothing failed', async () => {
    const notices: string[] = []

    await reapOrphanPodsWith({ reap: async () => sweepWith([]), notify: (text) => notices.push(text) })

    expect(notices).toEqual([])
    expect(podReapFailureNotice(sweepWith([]))).toBeNull()
  })

  it('stays quiet when Docker is down', async () => {
    const notices: string[] = []

    await reapOrphanPodsWith({
      reap: () => Promise.reject(new Error('connect ENOENT')),
      notify: (text) => notices.push(text),
    })

    expect(notices).toEqual([])
  })
})
