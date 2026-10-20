import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { ERunner, toThreadId } from '@dltech/atlas-core'
import {
  atlasDirectory,
  birthInCloud,
  DEFAULT_DOCKER_SOCKET,
  DockerEngine,
  ERuntimeKind,
  pingDocker,
  podHomeDigestOf,
  podHomeLabel,
  podThreadLabel,
  storedModel,
  type CloudBridge,
} from '@dltech/atlas-harness'

import { liveBridgeFor } from '../live-pod'
import { fakeApp, fakeCloud, scriptedModelPort } from './fake-app'
import { fakeSessionRuntime } from './fake-session-runtime'

const SOCKET = process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_DOCKER_SOCKET
const enabled = process.env.ATLAS_LIVE_DOCKER === '1' && (await pingDocker({ socketPath: SOCKET })) === undefined
const describeLive = enabled ? describe : describe.skip

const THREAD = toThreadId(`brn_tui_live_pod_${process.pid}`)
const LIVE_TIMEOUT_MS = 20 * 60_000

type Lease = { path: string; auth: string | null; body: { token: string } }

describeLive('a pod birth through the live TUI wiring', () => {
  const leases: Lease[] = []
  let server: ReturnType<typeof Bun.serve>

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        leases.push({
          path: new URL(request.url).pathname,
          auth: request.headers.get('authorization'),
          body: (await request.json()) as { token: string },
        })
        return new Response(null, { status: 204 })
      },
    })
  })

  afterAll(async () => {
    await server.stop(true)
  })

  it(
    'leases the token, runs a labelled pod that answers health, and marks the thread local',
    async () => {
      const app = fakeApp({
        model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }),
        cloud: fakeCloud({ session: { url: `http://127.0.0.1:${server.port}`, token: 'live-session', email: null } }),
      })
      const bridge: CloudBridge = liveBridgeFor(app)({ runner: ERunner.Local })
      try {
      await app.sessionOwner.placement.activate({ threadId: THREAD })

      const born = await birthInCloud({
        threadId: THREAD,
        runner: ERunner.Local,
        cwd: app.workspace.workspace,
        identity: app.workspace,
        model: storedModel(app.model.choice()),
        bridge,
        localThreads: app.threads,
        localLog: app.log,
        ids: app.ids,
        placement: app.sessionOwner,
        captureContext: async () => undefined,
        open: async ({ prepareRuntime }) =>
          prepareRuntime({
            kind: ERuntimeKind.Cloud,
            cwd: '/atlas/workspaces',
            adapters: fakeSessionRuntime(app),
          }),
      })

      if (!born.ok) throw new Error(`birth failed: ${born.detail}`)
      const lease = leases.find((held) => held.path === `/v1/pod-leases/${THREAD}`)
      expect(lease?.auth).toBe('Bearer live-session')
      expect(lease?.body.token).toBe(born.sandbox.token)

      const pods = await new DockerEngine({ socketPath: SOCKET }).listContainers({
        labels: { [podThreadLabel]: THREAD },
        all: false,
      })
      expect(pods).toHaveLength(1)
      expect(pods[0]?.name.replace(/^\//, '')).toStartWith('atlas-pod-')
      expect(pods[0]?.labels[podHomeLabel]).toBe(podHomeDigestOf({ home: atlasDirectory() }))

      const health = await fetch(`${born.sandbox.url}/v1/health`, {
        headers: { authorization: `Bearer ${born.sandbox.token}` },
      })
      expect(health.status).toBe(200)
      expect((await app.threads.find({ threadId: THREAD }))?.runner).toBe(ERunner.Local)
      } finally {
        await bridge.sandboxes.destroy({ threadId: THREAD })
      }
    },
    LIVE_TIMEOUT_MS,
  )
})
