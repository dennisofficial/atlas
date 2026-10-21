import { describe, expect, it } from 'bun:test'

import { EEffort, ERunner, toThreadId } from '@dltech/atlas-core'
import {
  birthInCloud,
  createLocalPodBridge,
  DEFAULT_DOCKER_SOCKET,
  DockerEngine,
  ERuntimeKind,
  ETurnStatus,
  pingDocker,
  podNameFor,
  podThreadLabel,
  type CloudAttachment,
} from '@dltech/atlas-harness'

import { createCloudRunner } from '../cloud/cloud-runner'
import { livePodBridgeOptionsFor } from '../live-pod'
import { fakeApp, fakeCloud, scriptedModelPort } from './fake-app'
import { fakeSessionRuntime } from './fake-session-runtime'
import {
  dockerCli,
  MODEL_ID,
  OPENROUTER_KEY,
  OPENROUTER_LEASE,
  READ_TRIGGER,
  startFakeModel,
  WRITE_TRIGGER,
} from './pod-session-live-fixture'

const SOCKET = process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_DOCKER_SOCKET
const enabled = process.env.ATLAS_LIVE_DOCKER === '1' && (await pingDocker({ socketPath: SOCKET })) === undefined
const describeLive = enabled ? describe : describe.skip

const THREAD = toThreadId(`brn_tui_pod_session_${process.pid}`)
const LIVE_TIMEOUT_MS = 20 * 60_000
const MARKER = `marker-${crypto.randomUUID()}`
const MARKER_PATH = '/atlas/workspaces/workspace/pod-marker.txt'
const POLL_MS = 500
const PARK_TIMEOUT_MS = 10 * 60_000

const waitFor = async ({ what, until, timeoutMs }: { what: string; until: () => Promise<boolean>; timeoutMs: number }) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await until()) return
    await Bun.sleep(POLL_MS)
  }
  throw new Error(`timed out waiting for ${what}`)
}

describeLive('a multi-turn session in a local pod', () => {
  it(
    'runs a tool in the pod, parks, wakes the same container, and still sees the workspace',
    async () => {
      const fakeModel = startFakeModel({ marker: MARKER })
      const leaseApi = Bun.serve({
        port: 0,
        hostname: '0.0.0.0',
        fetch: (request) => {
          const path = new URL(request.url).pathname
          if (path === '/v1/account-lease') return Response.json(OPENROUTER_LEASE)
          if (path === '/v1/settings') return Response.json({ settings: [] })
          if (path === '/v1/secrets') return Response.json({ secrets: [] })
          return new Response(null, { status: 204 })
        },
      })
      const app = fakeApp({
        pods: true,
        model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }),
        cloud: fakeCloud({ session: { url: `http://127.0.0.1:${leaseApi.port}`, token: 'live-session', email: null } }),
      })
      const options = livePodBridgeOptionsFor(app)
      const bridge = createLocalPodBridge({
        ...options,
        pod: () => ({ ...options.pod(), cloudUrl: `http://host.docker.internal:${leaseApi.port}` }),
        environment: () => ({ OPENROUTER_BASE_URL: fakeModel.url, ATLAS_CLASSIFIER_MODE: 'off' }),
      })
      const engine = new DockerEngine({ socketPath: SOCKET })
      const podIds = async (): Promise<string[]> =>
        (await engine.listContainers({ labels: { [podThreadLabel]: THREAD }, all: true })).map((pod) => pod.id)
      const attachments: CloudAttachment[] = []

      try {
        await app.sessionOwner.placement.activate({ threadId: THREAD })
        const born = await birthInCloud({
          threadId: THREAD,
          projectId: null,
          runner: ERunner.Local,
          identity: app.workspace,
          model: { ref: `openrouter/${MODEL_ID}`, effort: EEffort.Medium },
          bridge,
          localThreads: app.threads,
          localLog: app.log,
          ids: app.ids,
          placement: app.sessionOwner,
          open: async ({ attachment, prepareRuntime }) => {
            attachments.push(attachment)
            prepareRuntime({
              kind: ERuntimeKind.Cloud,
              cwd: '/atlas/workspaces',
              adapters: fakeSessionRuntime(app),
            })
          },
        })
        if (!born.ok) throw new Error(`birth failed: ${born.detail}`)

        const health = await fetch(`${born.sandbox.url}/v1/health`, {
          headers: { authorization: `Bearer ${born.sandbox.token}` },
        })
        expect(health.status).toBe(200)

        const [podId] = await podIds()
        if (podId === undefined) throw new Error('no pod carries the thread label')
        const attachment = attachments[0]
        if (attachment === undefined) throw new Error('birth never opened an attachment')
        const runner = createCloudRunner({
          bridge,
          channel: attachment.channel,
          threadId: THREAD,
          projectId: null,
        })

        const first = await runner.say({ threadId: THREAD, text: WRITE_TRIGGER })
        expect(first.status).toBe(ETurnStatus.Completed)
        expect(await dockerCli({ socket: SOCKET, args: ['exec', podId, 'cat', MARKER_PATH] })).toBe(MARKER)

        const parked = await fetch(`${born.sandbox.url}/v1/park`, {
          method: 'POST',
          headers: { authorization: `Bearer ${born.sandbox.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'pod-session-live' }),
        })
        expect(parked.status).toBe(200)
        await waitFor({
          what: 'the pod to exit',
          timeoutMs: PARK_TIMEOUT_MS,
          until: async () => (await bridge.sandboxes.find({ threadId: THREAD }))?.state === 'parked',
        })
        expect((await engine.inspectContainer({ id: podId })).state.running).toBe(false)

        const seen = fakeModel.requests.length
        const second = await runner.say({ threadId: THREAD, text: READ_TRIGGER })
        expect(second.status).toBe(ETurnStatus.Completed)

        expect(await podIds()).toEqual([podId])
        expect((await engine.inspectContainer({ id: podId })).state.running).toBe(true)
        const toolResults = fakeModel.requests
          .slice(seen)
          .flatMap((request) => request.messages.filter((message) => message.role === 'tool'))
        expect(JSON.stringify(toolResults)).toContain(MARKER)
        expect(new Set(fakeModel.authorizations)).toEqual(new Set([`Bearer ${OPENROUTER_KEY}`]))
      } finally {
        await bridge.sandboxes.destroy({ threadId: THREAD })
        await fakeModel.stop()
        await leaseApi.stop(true)
      }

      expect(await podIds()).toEqual([])
      const volumes = await dockerCli({
        socket: SOCKET,
        args: ['volume', 'ls', '--quiet', '--filter', `name=${podNameFor({ threadId: THREAD })}`],
      })
      expect(volumes.trim()).toBe('')
    },
    LIVE_TIMEOUT_MS,
  )
})
