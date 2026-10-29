import { afterAll, describe, expect, it } from 'bun:test'

import { randomUUID } from 'node:crypto'

import { DockerEngine } from '../../../execution/docker/engine'
import { DockerPodEngine } from '../../../execution/docker/pod-engine'
import { dockerUnavailableReason } from '../../../execution/docker/__tests__/live-docker'
import {
  DEFAULT_POD_IMAGE,
  dindVolumeNameFor,
  memoryReservationBytesFor,
  podCreateBody,
  podNameFor,
  podThreadLabel,
  workspaceVolumeNameFor,
} from '../pod-create'
import { hostPortFor } from '../ports'
import { SANDBOX_SERVE_PORT, SANDBOX_WORKSPACES_PATH } from '@dltech/atlas-wire'

const SOCKET = '/var/run/docker.sock'
const describeDocker =
  (await dockerUnavailableReason(SOCKET)) === undefined ? describe : describe.skip

const engine = new DockerEngine({ socketPath: SOCKET })
const pods = new DockerPodEngine({ socketPath: SOCKET })
const threadId = `pod-live-${process.pid}-${randomUUID().slice(0, 8)}`
const podName = podNameFor({ threadId })
const workspaceVolume = workspaceVolumeNameFor({ threadId })
const dindVolume = dindVolumeNameFor({ threadId })
const EXEC_TIMEOUT_MS = 90_000

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
  for (const name of [workspaceVolume, dindVolume]) {
    await attempt(() => pods.removeVolume({ name }))
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'pod-live cleanup left resources behind')
}

const dockerCli = async (args: readonly string[]): Promise<string> => {
  const child = Bun.spawn(['docker', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`docker ${args.join(' ')} exited ${exitCode}: ${stderr}`)
  return stdout.trim()
}

type RawInspect = {
  State: { Running: boolean }
  HostConfig: { Privileged: boolean; Init: boolean; Binds: string[] | null }
  Mounts: { Type: string; Name: string; Destination: string }[]
}

const inspectRaw = async (id: string): Promise<RawInspect> => {
  const response = await fetch(`http://localhost/containers/${id}/json`, {
    unix: SOCKET,
  })
  return (await response.json()) as RawInspect
}

const sh = async (args: { id: string; script: string; timeoutMs?: number }): Promise<string> => {
  const result = await pods.execSh({
    id: args.id,
    script: args.script,
    timeoutMs: args.timeoutMs ?? 30_000,
  })
  const stdout = (await result.stdout()).trim()
  if (result.exitCode !== 0)
    throw new Error(`exit ${result.exitCode}: ${args.script}\n${stdout}\n${await result.stderr()}`)
  return stdout
}

const waitFor = async (args: {
  what: string
  timeoutMs: number
  probe: () => Promise<boolean>
}): Promise<void> => {
  const deadline = Date.now() + args.timeoutMs
  while (Date.now() < deadline) {
    if (await args.probe().catch(() => false)) return
    await Bun.sleep(250)
  }
  throw new Error(`timed out waiting for ${args.what}`)
}

describeDocker('local pod create body against a live daemon', () => {
  afterAll(async () => {
    await sweep()
  }, 120_000)

  it('boots a pod, and stops on SIGTERM to PID 1', async () => {
    const serveHostPort = hostPortFor({
      session: threadId,
      containerPort: SANDBOX_SERVE_PORT,
    })

    await pods.createVolume({
      name: workspaceVolume,
      labels: { [podThreadLabel]: threadId },
    })
    await pods.createVolume({
      name: dindVolume,
      labels: { [podThreadLabel]: threadId },
    })
    const created = await engine.createContainer({
      name: podName,
      body: podCreateBody({
        threadId,
        home: '/tmp/atlas-pod-live-home',
        image: DEFAULT_POD_IMAGE,
        serveHostPort,
        vcpus: 1,
        token: 'live-token',
        cloudUrl: 'http://127.0.0.1:1',
        environment: {},
      }),
    })
    await engine.startContainer({ id: created.id })

    const inspected = await inspectRaw(created.id)
    expect(inspected.HostConfig.Privileged).toBe(true)
    expect(inspected.HostConfig.Init).toBe(true)
    expect(inspected.HostConfig.Binds ?? []).toEqual([])
    expect(inspected.Mounts).toHaveLength(2)
    const mounts = inspected.Mounts
    expect(mounts.every((mount) => mount.Type === 'volume')).toBe(true)
    expect(mounts.find((mount) => mount.Name === workspaceVolume)?.Destination).toBe(
      SANDBOX_WORKSPACES_PATH,
    )
    expect(mounts.find((mount) => mount.Name === dindVolume)?.Destination).toBe('/var/lib/docker')

    expect(await sh({ id: created.id, script: 'cat /sys/fs/cgroup/memory.low' })).toBe(
      String(memoryReservationBytesFor({ vcpus: 1 })),
    )
    expect(await sh({ id: created.id, script: 'cat /sys/fs/cgroup/memory.max' })).toBe('max')

    expect(await sh({ id: created.id, script: 'cat /proc/1/comm' })).toBe('docker-init')
    expect(await sh({ id: created.id, script: "tr '\\0' ' ' </proc/1/cmdline" })).toContain(
      'sleep infinity',
    )

    expect(
      await sh({
        id: created.id,
        script: 'docker version --format "{{.Server.Version}}"',
        timeoutMs: EXEC_TIMEOUT_MS,
      }),
    ).not.toBe('')

    const killedAt = performance.now()
    await dockerCli(['exec', podName, 'sh', '-c', 'kill -TERM 1'])
    await waitFor({
      what: 'the pod to stop',
      timeoutMs: 5_000,
      probe: async () => (await inspectRaw(created.id)).State.Running === false,
    })
    expect(performance.now() - killedAt).toBeLessThan(5_000)
    console.log(`pod stopped ${Math.round(performance.now() - killedAt)}ms after kill -TERM 1`)

    await sweep()
    expect(
      await dockerCli(['ps', '-a', '--filter', `name=${podName}`, '--format', '{{.Names}}']),
    ).toBe('')
    expect(
      await dockerCli(['volume', 'ls', '--filter', `name=${podName}`, '--format', '{{.Name}}']),
    ).toBe('')
  }, 240_000)
})
