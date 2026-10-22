import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import { DockerEngine } from '../../../execution/docker/engine'
import { DockerPodEngine } from '../../../execution/docker/pod-engine'
import { dockerUnavailableReason } from '../../../execution/docker/__tests__/live-docker'
import { createLocalPodBridge } from '../../local-pod-bridge'
import {
  DEFAULT_POD_IMAGE,
  dindVolumeNameFor,
  podNameFor,
  podThreadLabel,
  workspaceVolumeNameFor,
} from '../pod-create'
import { DockerPodDriver } from '../driver'
import { fileProvisionLock } from '../provision-lock'

const SOCKET = '/var/run/docker.sock'
const describeDocker =
  (await dockerUnavailableReason(SOCKET)) === undefined ? describe : describe.skip

const engine = new DockerEngine({ socketPath: SOCKET })
const pods = new DockerPodEngine({ socketPath: SOCKET })
const threadId = toThreadId(`pod-bridge-live-${process.pid}-${randomUUID().slice(0, 8)}`)
const podName = podNameFor({ threadId })
const serveToken = `live-${randomUUID()}`

type RecordedPut = { path: string; authorization: string | null; body: unknown }

const recordedPuts: RecordedPut[] = []

const startFakeApi = () =>
  Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      if (request.method !== 'PUT') return new Response('not found', { status: 404 })
      recordedPuts.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get('authorization'),
        body: await request.json(),
      })
      return new Response(null, { status: 204 })
    },
  })

const OPERATOR_SESSION = 'operator-session-bearer'

const sweep = async (): Promise<void> => {
  const failures: unknown[] = []
  const attempt = async (work: () => Promise<void>): Promise<void> => {
    await work().catch((failure: unknown) => failures.push(failure))
  }
  await attempt(async () => {
    for (const container of await engine.listContainers({
      labels: { [podThreadLabel]: threadId },
      all: true,
    })) {
      await attempt(() => engine.removeContainer({ id: container.id }))
    }
  })
  for (const name of [workspaceVolumeNameFor({ threadId }), dindVolumeNameFor({ threadId })]) {
    await attempt(() => pods.removeVolume({ name }))
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'local-pod-bridge-live cleanup left resources behind')
}

describeDocker('createLocalPodBridge against a live daemon', () => {
  let fakeApi: ReturnType<typeof startFakeApi> | undefined

  beforeAll(() => {
    fakeApi = startFakeApi()
  })

  afterAll(async () => {
    await fakeApi?.stop(true)
    await sweep()
  }, 120_000)

  it('births a pod, registers its lease with the serve token, and serves health', async () => {
    const apiUrl = `http://127.0.0.1:${fakeApi?.port}`
    const bridge = createLocalPodBridge({
      pod: () => ({
        image: DEFAULT_POD_IMAGE,
        socketPath: SOCKET,
        cloudUrl: apiUrl,
        home: join(tmpdir(), 'atlas-pod-bridge-live-home'),
      }),
      attachmentToken: () => serveToken,
      registerPodLease: async (lease) => {
        const response = await fetch(`${apiUrl}/v1/pod-leases/${lease.threadId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${OPERATOR_SESSION}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: lease.token }),
        })
        if (!response.ok) throw new Error(`lease PUT answered ${response.status}`)
      },
      onDriverLog: (line) => console.log(`[driver] ${line}`),
      driverWith: (config) =>
        new DockerPodDriver({
          ...config,
          provisionLock: fileProvisionLock({ directory: join(tmpdir(), 'atlas-pod-locks') }),
        }),
      sessionMirror: false,
    })

    const sandbox = await bridge.sandboxes.create({ threadId, projectId: null })

    expect(sandbox.created).toBe(true)
    expect(sandbox.token).toBe(serveToken)
    const leasePut = {
      path: `/v1/pod-leases/${threadId}`,
      authorization: `Bearer ${OPERATOR_SESSION}`,
      body: { token: serveToken },
    }
    expect(recordedPuts).toEqual([leasePut, leasePut])
    const health = await fetch(`${sandbox.url}/v1/health`, {
      headers: { Authorization: `Bearer ${serveToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    expect(health.status).toBe(200)
    expect(await bridge.sandboxes.find({ threadId })).toMatchObject({
      state: 'running',
      url: sandbox.url,
    })

    await bridge.sandboxes.destroy({ threadId })

    expect(await bridge.sandboxes.find({ threadId })).toMatchObject({ state: 'stopped' })
  }, 400_000)
})
