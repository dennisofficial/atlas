import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PodBridgeDriver } from '@dltech/atlas-harness'
import { createDesktopHost, type IDesktopHost } from '../../index'
import { SESSION_COOKIE } from '../../guard'
import { POD_INDEX_NAME } from '../pod-index'

const SECRET = 'b'.repeat(64)
const SESSION = 'better-auth.session_token=abc123'
const THREAD = 'thread-1'

interface IFakeState {
  running: Set<string>
  destroyed: string[]
  created: string[]
}

const HOME = mkdtempSync(join(tmpdir(), 'atlas-mac-pods-'))
let host: IDesktopHost
let upstream: ReturnType<typeof Bun.serve>
let leaseCookies: (string | null)[]
let leaseBodies: unknown[]
let leaseStatus: number
let dockerUp: boolean
let state: IFakeState

function fakeDriver(): PodBridgeDriver {
  return {
    createOrResume: async ({ name, token }) => {
      state.running.add(name)
      state.created.push(name)
      return { url: 'http://127.0.0.1:41000', state: 'running', created: true, token: token ?? '' }
    },
    inspect: async ({ name }) =>
      state.running.has(name) ? { state: 'running', url: 'http://127.0.0.1:41000' } : undefined,
    writeBootstrapFile: async () => undefined,
    readResources: async () => ({}),
    updateResources: async () => undefined,
    destroy: async ({ name }) => {
      state.running.delete(name)
      state.destroyed.push(name)
    },
  }
}

beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      leaseCookies.push(request.headers.get('cookie'))
      leaseBodies.push(await request.json())
      if (leaseStatus !== 200) {
        return Response.json(
          {
            error: {
              message: 'no',
              code: -32001,
              data: { code: 'UNAUTHORIZED', httpStatus: leaseStatus },
            },
          },
          { status: leaseStatus },
        )
      }
      return Response.json({ result: { data: null } })
    },
  })
  host = createDesktopHost({
    webRoot: '/nonexistent',
    secret: SECRET,
    apiOrigin: `http://127.0.0.1:${upstream.port}`,
    pods: {
      home: HOME,
      serveVersion: '1.2.3',
      driverWith: fakeDriver,
      ping: async () => (dockerUp ? undefined : 'socket missing'),
    },
  })
})

afterAll(async () => {
  await host.stop()
  upstream.stop(true)
})

beforeEach(() => {
  rmSync(join(HOME, POD_INDEX_NAME), { force: true })
  leaseCookies = []
  leaseBodies = []
  leaseStatus = 200
  dockerUp = true
  state = { running: new Set(), destroyed: [], created: [] }
})

const call = ({ path, method = 'GET', body }: { path: string; method?: string; body?: unknown }) =>
  fetch(`${host.url}${path}`, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE}=${SECRET}; ${SESSION}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  })

const create = () =>
  call({
    path: '/desktop/pods',
    method: 'POST',
    body: { threadId: THREAD, projectId: 'p1', model: 'm', effort: 'high' },
  })

describe('guard', () => {
  test('pod routes without the session cookie are 403', async () => {
    expect((await fetch(`${host.url}/desktop/pods`)).status).toBe(403)
    expect((await fetch(`${host.url}/desktop/capabilities`)).status).toBe(403)
  })
})

describe('capabilities', () => {
  test('docker reachable', async () => {
    expect(await (await call({ path: '/desktop/capabilities' })).json()).toEqual({ docker: true })
  })

  test('docker unreachable carries the reason', async () => {
    dockerUp = false
    expect(await (await call({ path: '/desktop/capabilities' })).json()).toEqual({
      docker: false,
      reason: 'socket missing',
    })
  })
})

describe('pods', () => {
  test('create registers the lease with the forwarded cookie and indexes the pod', async () => {
    const res = await create()
    expect(res.status).toBe(200)
    const pod = await res.json()
    expect(pod).toMatchObject({ threadId: THREAD, projectId: 'p1', model: 'm', state: 'running' })
    expect(leaseCookies).toHaveLength(1)
    expect(leaseCookies[0]).toBe(SESSION)
    expect(JSON.stringify(leaseBodies[0])).toContain(THREAD)
    const listed = (await (await call({ path: '/desktop/pods' })).json()) as { pods: unknown[] }
    expect(listed.pods).toHaveLength(1)
  })

  test('create is idempotent and keeps createdAt', async () => {
    const first = (await (await create()).json()) as { createdAt: string }
    const second = (await (await create()).json()) as { createdAt: string }
    expect(second.createdAt).toBe(first.createdAt)
    const listed = (await (await call({ path: '/desktop/pods' })).json()) as { pods: unknown[] }
    expect(listed.pods).toHaveLength(1)
  })

  test('invalid create input is 400', async () => {
    const res = await call({ path: '/desktop/pods', method: 'POST', body: { threadId: '' } })
    expect(res.status).toBe(400)
  })

  test('lease rejection is 502 and indexes nothing', async () => {
    leaseStatus = 401
    expect((await create()).status).toBe(502)
    const listed = (await (await call({ path: '/desktop/pods' })).json()) as { pods: unknown[] }
    expect(listed.pods).toHaveLength(0)
  })

  test('get returns the pod or 404', async () => {
    await create()
    expect((await call({ path: `/desktop/pods/${THREAD}` })).status).toBe(200)
    expect((await call({ path: '/desktop/pods/unknown' })).status).toBe(404)
  })

  test('connect returns url, persisted token and ~60s expiry', async () => {
    await create()
    const before = Date.now()
    const reply = (await (
      await call({ path: `/desktop/pods/${THREAD}/connect`, method: 'POST' })
    ).json()) as { url: string; token: string; expiresAt: string }
    expect(reply.url).toBe('http://127.0.0.1:41000')
    expect(reply.token).toHaveLength(64)
    expect(Date.parse(reply.expiresAt) - before).toBeGreaterThan(55_000)
    expect(Date.parse(reply.expiresAt) - before).toBeLessThanOrEqual(61_000)
    const again = (await (
      await call({ path: `/desktop/pods/${THREAD}/connect`, method: 'POST' })
    ).json()) as { token: string }
    expect(again.token).toBe(reply.token)
  })

  test('connect on a stopped pod is 409 pod-not-running, and wake restores it', async () => {
    await create()
    state.running.clear()
    const stopped = await call({ path: `/desktop/pods/${THREAD}/connect`, method: 'POST' })
    expect(stopped.status).toBe(409)
    expect(await stopped.json()).toEqual({ code: 'pod-not-running' })
    const woken = await call({ path: `/desktop/pods/${THREAD}/wake`, method: 'POST' })
    expect(((await woken.json()) as { state: string }).state).toBe('running')
    expect((await call({ path: `/desktop/pods/${THREAD}/connect`, method: 'POST' })).status).toBe(
      200,
    )
  })

  test('connect and wake on an unknown thread are 404', async () => {
    expect((await call({ path: '/desktop/pods/nope/connect', method: 'POST' })).status).toBe(404)
    expect((await call({ path: '/desktop/pods/nope/wake', method: 'POST' })).status).toBe(404)
  })

  test('list reports a stopped pod as stopped', async () => {
    await create()
    state.running.clear()
    const listed = (await (await call({ path: '/desktop/pods' })).json()) as {
      pods: { state: string }[]
    }
    expect(listed.pods[0]?.state).toBe('stopped')
  })

  test('delete destroys the pod and drops it from the index', async () => {
    await create()
    const res = await call({ path: `/desktop/pods/${THREAD}`, method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(state.destroyed).toHaveLength(1)
    expect((await call({ path: `/desktop/pods/${THREAD}` })).status).toBe(404)
  })
})
