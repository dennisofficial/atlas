import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { atlasDirectory, type OrphanPodSweep } from '@dltech/atlas-harness'

import { fakeApp, fakeCloud, fakeSignedOutCloud, scriptedModelPort } from './fake-app'
import { cloudUrlOf } from '../live-cloud'
import {
  dockerRefusal,
  liveBirthPreflight,
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

  it('leases the pod token through podLeases.register with the session bearer', async () => {
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
        return Response.json({ result: { data: null } })
      },
    })
    try {
      const app = fakeApp({
        model,
        cloud: fakeCloud({
          session: { url: `http://127.0.0.1:${server.port}`, token: 'sess', email: null },
        }),
      })

      await livePodBridgeOptionsFor(app).registerPodLease({
        threadId: toThreadId('brn_lease'),
        token: 'pod-token',
      })

      expect(seen).toEqual([
        {
          method: 'POST',
          path: '/v1/trpc/podLeases.register',
          auth: 'Bearer sess',
          body: { threadId: 'brn_lease', token: 'pod-token' },
        },
      ])
    } finally {
      await server.stop(true)
    }
  })

  it('registers the born thread through threads.create with the session bearer', async () => {
    const seen: { path: string; auth: string | null; body: unknown }[] = []
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        seen.push({
          path: new URL(request.url).pathname,
          auth: request.headers.get('authorization'),
          body: await request.json(),
        })
        return Response.json({ result: { data: { id: 'brn_born' } } })
      },
    })
    try {
      const app = fakeApp({
        model,
        cloud: fakeCloud({
          session: { url: `http://127.0.0.1:${server.port}`, token: 'sess', email: null },
        }),
      })

      await livePodBridgeOptionsFor(app).registerThread?.({
        threadId: toThreadId('brn_born'),
        projectId: 'proj_1',
        model: 'claude-x',
        effort: 'high',
      })

      expect(seen).toEqual([
        {
          path: '/v1/trpc/threads.create',
          auth: 'Bearer sess',
          body: { id: 'brn_born', projectId: 'proj_1', model: 'claude-x', effort: 'high' },
        },
      ])
    } finally {
      await server.stop(true)
    }
  })

  it('refuses to register a thread while signed out', () => {
    const app = fakeApp({ model, cloud: fakeSignedOutCloud() })

    expect(() =>
      livePodBridgeOptionsFor(app).registerThread?.({
        threadId: toThreadId('brn_born'),
        projectId: null,
      }),
    ).toThrow('sign in to Atlas Cloud')
  })

  it('reads the mirrored checkpoint through localPodCheckpoint.get with the session bearer', async () => {
    const seen: { path: string; auth: string | null }[] = []
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) => {
        seen.push({
          path: new URL(request.url).pathname,
          auth: request.headers.get('authorization'),
        })
        return Response.json(
          {
            error: { message: 'none', code: -32004, data: { code: 'NOT_FOUND', httpStatus: 404 } },
          },
          { status: 404 },
        )
      },
    })
    try {
      const app = fakeApp({
        model,
        cloud: fakeCloud({
          session: { url: `http://127.0.0.1:${server.port}`, token: 'sess', email: null },
        }),
      })

      const answer = await livePodBridgeOptionsFor(app).readPodCheckpoint?.({
        threadId: toThreadId('brn_born'),
      })

      expect(answer).toBeNull()
      expect(seen).toEqual([{ path: '/v1/trpc/localPodCheckpoint.get', auth: 'Bearer sess' }])
    } finally {
      await server.stop(true)
    }
  })

  it('reads no checkpoint while signed out, without throwing', async () => {
    const app = fakeApp({ model, cloud: fakeSignedOutCloud() })

    expect(
      await livePodBridgeOptionsFor(app).readPodCheckpoint?.({ threadId: toThreadId('brn_born') }),
    ).toBeNull()
  })

  it('refuses to lease while signed out', () => {
    const app = fakeApp({ model, cloud: fakeSignedOutCloud() })

    expect(() =>
      livePodBridgeOptionsFor(app).registerPodLease({
        threadId: toThreadId('brn_lease'),
        token: 't',
      }),
    ).toThrow('sign in to Atlas Cloud')
  })
})

describe('the pod birth preflight', () => {
  it('names Docker Desktop and the socket when nothing answers', async () => {
    process.env.ATLAS_DOCKER_SOCKET = '/nonexistent/atlas-docker.sock'

    const refusal = await liveBirthPreflight({ runner: ERunner.Local })

    expect(refusal).toContain('/nonexistent/atlas-docker.sock')
    expect(refusal).toContain('start Docker Desktop')
    expect(await dockerRefusal()).toBe(refusal)
  })
})

const sweepWith = (failures: OrphanPodSweep['failures']): OrphanPodSweep => ({
  reaped: [],
  kept: [],
  failures,
})

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

    await reapOrphanPodsWith({
      reap: async () => sweepWith([]),
      notify: (text) => notices.push(text),
    })

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
