import { afterAll, describe, expect, it } from 'vitest'

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const SOCKET = '/var/run/docker.sock'
const describeDocker = (await dockerUnavailableReason(SOCKET)) === undefined ? describe : describe.skip

const engine = new DockerEngine({ socketPath: SOCKET })
const pods = new DockerPodEngine({ socketPath: SOCKET })
const threadId = `pod-driver-live-${process.pid}-${randomUUID().slice(0, 8)}`
const podName = podNameFor({ threadId })
const workspaceVolume = workspaceVolumeNameFor({ threadId })
const dindVolume = dindVolumeNameFor({ threadId })
const MARKER_PATH = '/atlas/workspaces/marker'
const MARKER_CONTENT = 'survives-a-stop'
const ELF_MACHINE_OFFSET = 18

const sweep = async (): Promise<void> => {
  const failures: unknown[] = []
  const attempt = async (work: () => Promise<void>): Promise<void> => {
    await work().catch((failure: unknown) => failures.push(failure))
  }
  await attempt(async () => {
    for (const container of await engine.listContainers({ labels: { [podThreadLabel]: threadId }, all: true })) {
      await attempt(() => engine.removeContainer({ id: container.id }))
    }
  })
  for (const name of [workspaceVolume, dindVolume]) {
    await attempt(() => pods.removeVolume({ name }))
  }
  if (failures.length > 0) throw new AggregateError(failures, 'pod-driver-live cleanup left resources behind')
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

const sh = async (script: string): Promise<string> => {
  const result = await pods.execSh({ id: podName, script, timeoutMs: 30_000 })
  const stdout = (await result.stdout()).trim()
  if (result.exitCode !== 0) throw new Error(`exit ${result.exitCode}: ${script}\n${stdout}\n${await result.stderr()}`)
  return stdout
}

const healthStatus = async (args: { url: string; token: string }): Promise<number> => {
  const response = await fetch(`${args.url}/v1/health`, {
    headers: { Authorization: `Bearer ${args.token}` },
    signal: AbortSignal.timeout(10_000),
  })
  return response.status
}

const podIds = async (): Promise<string[]> =>
  (await engine.listContainers({ labels: { [podThreadLabel]: threadId }, all: true })).map((one) => one.id)

describeDocker('DockerPodDriver against a live daemon', () => {
  afterAll(async () => {
    await sweep()
  }, 120_000)

  it('boots, serves, survives a stop, resizes, and destroys cleanly', async () => {
    const driver = new DockerPodDriver({
      image: DEFAULT_POD_IMAGE,
      socketPath: SOCKET,
      serveVersion: undefined,
      provisionLock: fileProvisionLock({ directory: join(tmpdir(), 'atlas-pod-locks') }),
      cloudUrl: 'http://127.0.0.1:1',
      home: join(tmpdir(), 'atlas-pod-driver-live-home'),
      log: (line) => console.log(`[driver] ${line}`),
    })
    const token = `live-${randomUUID()}`
    let staged = false

    const first = await driver.createOrResume({
      name: podName,
      threadId,
      token,
      putContextOnFreshBoot: async (handle) => {
        staged = true
        await driver.writeBootstrapFile({
          name: handle.name,
          path: WORKSPACE_SPEC_PATH,
          content: bootstrapSpecOf({ projectId: null }),
        })
      },
    })

    expect(first.created).toBe(true)
    expect(staged).toBe(true)
    expect(first.state).toBe('running')
    expect(await healthStatus({ url: first.url, token })).toBe(200)
    expect(await sh(`cat ${WORKSPACE_SPEC_PATH}`)).toBe(bootstrapSpecOf({ projectId: null }))
    expect(await driver.inspect({ name: podName })).toEqual({ state: 'running', url: first.url })

    const elfMachine = await sh(`od -An -tx1 -j${ELF_MACHINE_OFFSET} -N2 /opt/atlas/atlas-serve`)
    expect(elfMachine.replace(/\s+/g, ' ').trim()).toBe(process.arch === 'arm64' ? 'b7 00' : '3e 00')
    expect(await sh('uname -m')).toBe(process.arch === 'arm64' ? 'aarch64' : 'x86_64')

    await sh(`printf '%s' ${MARKER_CONTENT} > ${MARKER_PATH}`)
    const [originalId] = await podIds()
    await engine.stopContainer({ id: podName })
    expect((await driver.inspect({ name: podName }))?.state).toBe('parked')

    const second = await driver.createOrResume({ name: podName, threadId, token })

    expect(second.created).toBe(false)
    expect(await podIds()).toEqual([originalId!])
    expect(await sh(`cat ${MARKER_PATH}`)).toBe(MARKER_CONTENT)
    expect(await healthStatus({ url: second.url, token })).toBe(200)

    await driver.updateResources({ name: podName, vcpus: 1 })
    expect(await sh('cat /sys/fs/cgroup/cpu.max')).toBe('100000 100000')
    expect(await sh('cat /sys/fs/cgroup/memory.low')).toBe(String(2048 * 1024 * 1024))
    expect(await driver.readResources({ name: podName })).toEqual({ vcpus: 1, memoryMb: 2048 })

    await driver.destroy({ name: podName })

    expect(await dockerCli(['ps', '-a', '--filter', `name=${podName}`, '--format', '{{.Names}}'])).toBe('')
    expect(await dockerCli(['volume', 'ls', '--filter', `name=${podName}`, '--format', '{{.Name}}'])).toBe('')
    expect(await driver.inspect({ name: podName })).toBeUndefined()
  }, 400_000)
})
