import { afterAll, describe, expect, it } from 'bun:test'

import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DockerProcessPort } from '../docker-process'
import { DockerEngine } from '../engine'
import { sandboxNameFor, worktreeLabel, type SandboxConfig } from '../sandbox'
import { removeTestSandboxes, uniqueTestPrefix } from './docker-test-cleanup'
import { dockerUnavailableReason } from './live-docker'
import { ESandboxState, type SandboxStatus } from '../status'

const SOCKET = '/var/run/docker.sock'
const DOCKER_AVAILABLE = (await dockerUnavailableReason(SOCKET)) === undefined
const describeDocker = DOCKER_AVAILABLE ? describe : describe.skip

const engine = new DockerEngine({ socketPath: SOCKET })
const PREFIX = uniqueTestPrefix('process-status')

const worktree = await realpath(await mkdtemp(join(tmpdir(), 'atlas-dev-status-')))

const extraWorktrees: string[] = []

afterAll(async () => {
  try {
    if (DOCKER_AVAILABLE) await removeTestSandboxes({ engine, prefix: PREFIX })
  } finally {
    for (const dir of [worktree, ...extraWorktrees]) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

const sandboxConfig = (image = 'node:22-slim'): SandboxConfig => ({
  image,
  worktree,
  session: worktree,
  uid: 501,
  gid: 20,
  home: '/Users/operator',
  limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
  dockerSocket: SOCKET,
  labelPrefix: PREFIX,
})

const runTrue = async (port: DockerProcessPort): Promise<number> => {
  const handle = port.spawn({ cmd: ['true'], cwd: worktree })
  return await handle.exited
}

describeDocker('DockerProcessPort sandbox status', () => {
  it('announces starting then running, with the ports the daemon bound', async () => {
    const seen: SandboxStatus[] = []
    const port = new DockerProcessPort({
      engine,
      sandbox: sandboxConfig(),
      onStatus: (status) => seen.push(status),
    })

    expect(await runTrue(port)).toBe(0)

    expect(seen.map((one) => one.state)).toEqual([ESandboxState.Starting, ESandboxState.Running])
    const running = seen[1]
    if (running?.state !== ESandboxState.Running) throw new Error('unreachable')
    expect(running.name).toBe(sandboxNameFor({ prefix: PREFIX, session: worktree }))
    expect(running.ports.length).toBeGreaterThan(0)
    expect(running.ports[0]?.hostPort).toBeGreaterThan(0)
  }, 60_000)

  it("announces failed with the daemon's reason when the container cannot be created", async () => {
    const missingWorktree = await realpath(await mkdtemp(join(tmpdir(), 'atlas-dev-status-failed-')))
    extraWorktrees.push(missingWorktree)
    const seen: SandboxStatus[] = []
    const port = new DockerProcessPort({
      engine,
      sandbox: {
        ...sandboxConfig('atlas-dev-no-such-image:latest'),
        worktree: missingWorktree,
        session: missingWorktree,
      },
      onStatus: (status) => seen.push(status),
    })

    await expect(runTrue(port)).rejects.toThrow()

    const failed = seen.at(-1)
    if (failed?.state !== ESandboxState.Failed) throw new Error(`expected failed, got ${failed?.state ?? 'nothing'}`)
    expect(failed.reason).toContain('atlas-dev-no-such-image')
  }, 60_000)

  it('restarts the sandbox on the next spawn when the daemon stopped it behind our back', async () => {
    const seen: SandboxStatus[] = []
    const port = new DockerProcessPort({
      engine,
      sandbox: sandboxConfig(),
      onStatus: (status) => seen.push(status),
    })

    expect(await runTrue(port)).toBe(0)

    const found = await engine.listContainers({
      labels: { [worktreeLabel(PREFIX)]: worktree },
      all: true,
    })
    const sandbox = found[0]
    if (sandbox === undefined) throw new Error('the first spawn created no sandbox')
    await engine.stopContainer({ id: sandbox.id })

    expect(await runTrue(port)).toBe(0)

    const restarted = await engine.inspectContainer({ id: sandbox.id })
    expect(restarted.state.running).toBe(true)
    expect(seen.map((one) => one.state)).toEqual([
      ESandboxState.Starting,
      ESandboxState.Running,
      ESandboxState.Stopped,
      ESandboxState.Starting,
      ESandboxState.Running,
    ])
  }, 60_000)

  it('re-ensures after being told the sandbox stopped, so the next spawn restarts it', async () => {
    const seen: SandboxStatus[] = []
    const port = new DockerProcessPort({
      engine,
      sandbox: sandboxConfig(),
      onStatus: (status) => seen.push(status),
    })

    expect(await runTrue(port)).toBe(0)

    const found = await engine.listContainers({
      labels: { [worktreeLabel(PREFIX)]: worktree },
      all: true,
    })
    const sandbox = found[0]
    if (sandbox === undefined) throw new Error('the first spawn created no sandbox')
    await engine.stopContainer({ id: sandbox.id })
    port.sandboxStopped()

    expect(await runTrue(port)).toBe(0)

    const restarted = await engine.inspectContainer({ id: sandbox.id })
    expect(restarted.state.running).toBe(true)
    expect(seen.map((one) => one.state)).toEqual([
      ESandboxState.Starting,
      ESandboxState.Running,
      ESandboxState.Starting,
      ESandboxState.Running,
    ])
  }, 60_000)
})
