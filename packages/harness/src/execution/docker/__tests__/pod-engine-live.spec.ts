import { afterAll, afterEach, describe, expect, it } from 'bun:test'

import { DockerEngine } from '../engine'
import { DockerPodEngine } from '../pod-engine'
import { uniqueTestPrefix } from './docker-test-cleanup'
import { dockerUnavailableReason } from './live-docker'

const SOCKET = '/var/run/docker.sock'
const describeDocker = (await dockerUnavailableReason(SOCKET)) === undefined ? describe : describe.skip

const engine = new DockerEngine({ socketPath: SOCKET })
const pods = new DockerPodEngine({ socketPath: SOCKET })
const RUN = uniqueTestPrefix('pod-engine').replace(/^atlas-dev-/, 'atlas-pod-spec-')
const LABELS = { 'atlas-pod.spec': RUN }

const sweep = async (): Promise<void> => {
  for (const container of await engine.listContainers({ labels: LABELS, all: true })) {
    await engine.removeContainer({ id: container.id })
  }
  for (const volume of await pods.listVolumes({ labels: LABELS })) {
    await pods.removeVolume({ name: volume.name })
  }
}

describeDocker('DockerPodEngine against a live daemon', () => {
  afterEach(sweep)
  afterAll(sweep)

  it('writes through a volume, reads back, resizes, and cleans up', async () => {
    const volume = `${RUN}-volume`
    const content = 'hello from put-archive\n'

    await pods.createVolume({ name: volume, labels: LABELS })
    const created = await engine.createContainer({
      name: `${RUN}-container`,
      body: {
        Image: 'alpine:latest',
        Cmd: ['sleep', 'infinity'],
        Labels: LABELS,
        HostConfig: { Binds: [`${volume}:/data`] },
      },
    })
    await engine.startContainer({ id: created.id })

    await pods.writeFile({ id: created.id, path: '/data/hello.txt', content })
    const read = await pods.execSh({ id: created.id, script: 'cat /data/hello.txt', timeoutMs: 30_000 })
    expect(read.exitCode).toBe(0)
    expect(await read.stdout()).toBe(content)

    await pods.updateContainer({
      id: created.id,
      resources: { nanoCpus: 1e9, memoryReservationBytes: 256 * 1024 * 1024 },
    })
    const cpuMax = await pods.execSh({ id: created.id, script: 'cat /sys/fs/cgroup/cpu.max', timeoutMs: 30_000 })
    expect((await cpuMax.stdout()).trim()).toBe('100000 100000')
    expect((await engine.inspectContainer({ id: created.id })).hostConfig.nanoCpus).toBe(1e9)
    const memoryLow = await pods.execSh({ id: created.id, script: 'cat /sys/fs/cgroup/memory.low', timeoutMs: 30_000 })
    expect((await memoryLow.stdout()).trim()).toBe(String(256 * 1024 * 1024))

    await engine.removeContainer({ id: created.id })
    await pods.removeVolume({ name: volume })

    expect(await engine.listContainers({ labels: LABELS, all: true })).toEqual([])
    expect(await pods.listVolumes({ labels: LABELS })).toEqual([])
  }, 120_000)
})
