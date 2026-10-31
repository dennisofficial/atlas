import { afterAll, beforeAll, beforeEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PodBridgeDriver } from '@dltech/atlas-harness'
import { openLocalStore } from '../local-store'
import { createDesktopHost, type IDesktopHost } from '../../index'
import { SESSION_COOKIE } from '../../guard'
import { createTokenStore } from '../../auth/token-store'

const SECRET = 'b'.repeat(64)
const SESSION = 'better-auth.session_token=abc123'
export const THREAD = 'thread-1'

interface IFakeState {
  running: Set<string>
  destroyed: string[]
  created: string[]
  bootstraps: string[]
}

export const HOME = mkdtempSync(join(tmpdir(), 'atlas-mac-pods-'))
const AUTH_HOME = mkdtempSync(join(tmpdir(), 'atlas-mac-auth-'))
process.env.ATLAS_HOME = HOME
export let host: IDesktopHost
let upstream: ReturnType<typeof Bun.serve>
export let leaseHeaders: {
  authorization: string | null
  cookie: string | null
  origin: string | null
}[]
export let leaseBodies: unknown[]
export let leaseStatus: number
export let dockerUp: boolean
export let state: IFakeState

function fakeDriver(): PodBridgeDriver {
  return {
    createOrResume: async ({ name, token, putContextOnFreshBoot }) => {
      state.running.add(name)
      state.created.push(name)
      await putContextOnFreshBoot?.({ name })
      return { url: 'http://127.0.0.1:41000', state: 'running', created: true, token: token ?? '' }
    },
    inspect: async ({ name }) =>
      state.running.has(name) ? { state: 'running', url: 'http://127.0.0.1:41000' } : undefined,
    writeBootstrapFile: async ({ content }) => {
      state.bootstraps.push(
        typeof content === 'string' ? content : new TextDecoder().decode(content),
      )
    },
    readResources: async () => ({}),
    updateResources: async () => undefined,
    destroy: async ({ name }) => {
      state.running.delete(name)
      state.destroyed.push(name)
    },
  }
}

export function useDesktopHost(): void {
  beforeAll(() => {
    upstream = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        leaseHeaders.push({
          authorization: request.headers.get('authorization'),
          cookie: request.headers.get('cookie'),
          origin: request.headers.get('origin'),
        })
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
      auth: { home: AUTH_HOME },
      pods: {
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
    rmSync(join(HOME, 'sessions'), { recursive: true, force: true })
    leaseHeaders = []
    createTokenStore({ home: AUTH_HOME }).save({ token: 'bearer-tok' })
    leaseBodies = []
    leaseStatus = 200
    dockerUp = true
    state = { running: new Set(), destroyed: [], created: [], bootstraps: [] }
  })
}

export const call = ({
  path,
  method = 'GET',
  body,
}: {
  path: string
  method?: string
  body?: unknown
}) =>
  fetch(`${host.url}${path}`, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE}=${SECRET}; ${SESSION}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  })

export const create = () =>
  call({
    path: '/desktop/pods',
    method: 'POST',
    body: { threadId: THREAD, projectId: 'p1', model: 'm', effort: 'high' },
  })

export const failLeaseWith = (status: number): void => {
  leaseStatus = status
}

export const stopDocker = (): void => {
  dockerUp = false
}

export const sharedStore = () => openLocalStore({ home: HOME })
