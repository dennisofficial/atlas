import { afterAll, describe, expect, it } from 'bun:test'

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import { DockerEngine } from '../../../execution/docker/engine'
import { DockerPodEngine } from '../../../execution/docker/pod-engine'
import { dockerUnavailableReason } from '../../../execution/docker/__tests__/live-docker'
import { bootstrapSpecOf, WORKSPACE_SPEC_PATH } from '../../local-cloud-bootstrap'
import { DockerPodDriver } from '../driver'
import {
  DEFAULT_POD_IMAGE,
  dindVolumeNameFor,
  podNameFor,
  podThreadLabel,
  workspaceVolumeNameFor,
} from '../pod-create'
import { fileProvisionLock } from '../provision-lock'
import { reapOrphanPods } from '../reaper'

const SOCKET = '/var/run/docker.sock'
const describeDocker =
  (await dockerUnavailableReason(SOCKET)) === undefined ? describe : describe.skip

const engine = new DockerEngine({ socketPath: SOCKET })
const pods = new DockerPodEngine({ socketPath: SOCKET })
const runId = `${process.pid}-${randomUUID().slice(0, 8)}`
const parkedThreadId = `pod-lifecycle-live-park-${runId}`
const orphanThreadId = `pod-lifecycle-live-orphan-${runId}`
const parkedPodName = podNameFor({ threadId: parkedThreadId })
const orphanPodName = podNameFor({ threadId: orphanThreadId })
const MARKER_PATH = '/atlas/workspaces/marker'
const MARKER_CONTENT = 'survives-a-self-park'
const EXIT_DEADLINE_MS = 5_000
const EXIT_POLL_MS = 50

const sweepThread = async ({
  threadId,
  failures,
}: {
  threadId: string
  failures: unknown[]
}): Promise<void> => {
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
}

const sweep = async (): Promise<void> => {
  const failures: unknown[] = []
  for (const threadId of [parkedThreadId, orphanThreadId]) await sweepThread({ threadId, failures })
  if (failures.length > 0)
    throw new AggregateError(failures, 'pod-lifecycle-live cleanup left resources behind')
}

const dockerCli = async (args: readonly string[]): Promise<string> => {
  const child = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`docker ${args.join(' ')} exited ${exitCode}: ${stderr}`)
  return stdout.trim()
}

const sh = async (args: { podName: string; script: string }): Promise<string> => {
  const result = await pods.execSh({ id: args.podName, script: args.script, timeoutMs: 30_000 })
  const stdout = (await result.stdout()).trim()
  if (result.exitCode !== 0) {
    throw new Error(`exit ${result.exitCode}: ${args.script}\n${stdout}\n${await result.stderr()}`)
  }
  return stdout
}

const healthStatus = async (args: { url: string; token: string }): Promise<number> => {
  const response = await fetch(`${args.url}/v1/health`, {
    headers: { Authorization: `Bearer ${args.token}` },
    signal: AbortSignal.timeout(10_000),
  })
  return response.status
}

const podIdsOf = async (threadId: string): Promise<string[]> =>
  (await engine.listContainers({ labels: { [podThreadLabel]: threadId }, all: true })).map(
    (one) => one.id,
  )

const msUntilExited = async (args: { podName: string; startedAt: number }): Promise<number> => {
  const deadline = args.startedAt + EXIT_DEADLINE_MS
  while (Date.now() < deadline) {
    if ((await pods.inspectPod({ id: args.podName }))?.status === 'exited')
      return Date.now() - args.startedAt
    await Bun.sleep(EXIT_POLL_MS)
  }
  throw new Error(`${args.podName} did not exit within ${EXIT_DEADLINE_MS} ms of SIGTERM to pid 1`)
}

const bootArgsFor = (args: { driver: DockerPodDriver; threadId: string; token: string }) => ({
  name: podNameFor({ threadId: args.threadId }),
  threadId: args.threadId,
  token: args.token,
  putContextOnFreshBoot: async (handle: { name: string }) => {
    await args.driver.writeBootstrapFile({
      name: handle.name,
      path: WORKSPACE_SPEC_PATH,
      content: bootstrapSpecOf({ projectId: null }),
    })
  },
})

const LIVE_HOME = join(tmpdir(), 'atlas-pod-lifecycle-live-home')

describeDocker('pod lifecycle against a live daemon', () => {
  const driver = new DockerPodDriver({
    image: DEFAULT_POD_IMAGE,
    socketPath: SOCKET,
    serveVersion: undefined,
    provisionLock: fileProvisionLock({ directory: join(tmpdir(), 'atlas-pod-locks') }),
    cloudUrl: 'http://127.0.0.1:1',
    home: LIVE_HOME,
    log: (line) => console.log(`[driver] ${line}`),
  })
  const parkedToken = `live-${randomUUID()}`
  let parkedOriginalId: string | undefined

  afterAll(async () => {
    await sweep()
  }, 120_000)

  it('parks itself on SIGTERM to pid 1 and wakes with its disk intact', async () => {
    const first = await driver.createOrResume(
      bootArgsFor({ driver, threadId: parkedThreadId, token: parkedToken }),
    )
    expect(first.created).toBe(true)
    expect(await healthStatus({ url: first.url, token: parkedToken })).toBe(200)

    await sh({ podName: parkedPodName, script: `printf '%s' ${MARKER_CONTENT} > ${MARKER_PATH}` })
    const originalIds = await podIdsOf(parkedThreadId)
    expect(originalIds).toHaveLength(1)
    parkedOriginalId = originalIds[0]

    const startedAt = Date.now()
    await pods
      .execSh({ id: parkedPodName, script: `kill -TERM 1`, timeoutMs: 10_000 })
      .catch(() => undefined)
    const exitLatencyMs = await msUntilExited({ podName: parkedPodName, startedAt })
    console.log(`[lifecycle] SIGTERM to pid 1 -> exited in ${exitLatencyMs} ms`)
    expect(exitLatencyMs).toBeLessThan(EXIT_DEADLINE_MS)
    expect((await driver.inspect({ name: parkedPodName }))?.state).toBe('parked')

    const second = await driver.createOrResume({
      name: parkedPodName,
      threadId: parkedThreadId,
      token: parkedToken,
    })

    expect(second.created).toBe(false)
    expect(await podIdsOf(parkedThreadId)).toEqual([parkedOriginalId!])
    expect(await sh({ podName: parkedPodName, script: `cat ${MARKER_PATH}` })).toBe(MARKER_CONTENT)
    expect(await healthStatus({ url: second.url, token: parkedToken })).toBe(200)
  }, 400_000)

  it('reaps only the orphan pod, volumes included, and keeps a pod whose thread lives', async () => {
    const orphanToken = `live-${randomUUID()}`
    const orphan = await driver.createOrResume(
      bootArgsFor({ driver, threadId: orphanThreadId, token: orphanToken }),
    )
    expect(orphan.created).toBe(true)
    expect(await podIdsOf(orphanThreadId)).toHaveLength(1)

    const consulted: string[] = []
    const result = await reapOrphanPods({
      engine,
      destroyPod: (destroyArgs) => driver.destroy(destroyArgs),
      home: LIVE_HOME,
      threadExists: async ({ threadId }) => {
        consulted.push(threadId)
        return threadId !== toThreadId(orphanThreadId)
      },
      log: (line) => console.log(`[reaper] ${line}`),
    })

    expect(result.failures).toEqual([])
    expect(result.reaped).toEqual([orphanPodName])
    expect(consulted).toContain(orphanThreadId)
    expect(result.kept).toContain(parkedPodName)
    expect(
      await dockerCli(['ps', '-a', '--filter', `name=${orphanPodName}`, '--format', '{{.Names}}']),
    ).toBe('')
    expect(
      await dockerCli([
        'volume',
        'ls',
        '--filter',
        `name=${orphanPodName}`,
        '--format',
        '{{.Name}}',
      ]),
    ).toBe('')

    expect(await podIdsOf(parkedThreadId)).toEqual([parkedOriginalId!])
    expect((await driver.inspect({ name: parkedPodName }))?.state).toBe('running')

    await driver.destroy({ name: parkedPodName })
    expect(
      await dockerCli(['ps', '-a', '--filter', `name=${parkedPodName}`, '--format', '{{.Names}}']),
    ).toBe('')
    expect(
      await dockerCli([
        'volume',
        'ls',
        '--filter',
        `name=${parkedPodName}`,
        '--format',
        '{{.Name}}',
      ]),
    ).toBe('')
  }, 400_000)
})
