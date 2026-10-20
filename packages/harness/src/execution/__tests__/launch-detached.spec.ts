import { describe, expect, it } from 'bun:test'

import { mkdtempSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.ATLAS_HOME = join(mkdtempSync(join(tmpdir(), 'atlas-launch-detached-')), '.atlas-home')

import {
  EExecutionLocation,
  toThreadId,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
  type ThreadId,
} from '@dltech/atlas-core'

import { DockerProcessPort } from '../docker/docker-process'
import { DockerEngine, EngineRequestFailed, type ContainerDetails, type ContainerSummary, type ExecState } from '../docker/engine'
import { sandboxCreateBody, type SandboxConfig } from '../docker/sandbox'
import { LocalProcessPort, type LocalProcessHandle } from '../local-process'
import { LoginEnvProcessPort } from '../login-env-process'
import { RoutedProcessPort } from '../routed-process'

const HOST_THREAD = toThreadId('host-thread')
const DOCKER_THREAD = toThreadId('docker-thread')

const sandboxConfig = (): SandboxConfig => ({
  image: 'node:22-slim',
  worktree: '/work',
  session: 'session-test',
  uid: 501,
  gid: 20,
  home: '/home/operator',
  limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
  dockerSocket: '/var/run/docker.sock',
})

type StartedExec = { execId: string; detach: boolean | undefined }
type CreatedExec = { cmd: readonly string[]; cwd: string; env: Record<string, string> }

class RecordingEngine extends DockerEngine {
  running = true
  readonly created: CreatedExec[] = []
  readonly started: StartedExec[] = []
  failNextCreate: Error | null = null

  constructor() {
    super({ socketPath: '/atlas-dev-stub.sock' })
  }

  override async listContainers(): Promise<ContainerSummary[]> {
    return [{ id: 'c1', name: 'atlas-stub', state: this.running ? 'running' : 'exited', labels: {} }]
  }

  override async inspectContainer(): Promise<ContainerDetails> {
    return {
      id: 'c1',
      name: 'atlas-stub',
      state: { running: this.running },
      config: {
        labels: sandboxCreateBody(sandboxConfig()).Labels ?? {},
        env: ['PATH=/usr/local/bin'],
        image: 'node:22-slim',
      },
      mounts: [],
      ports: [],
      hostConfig: { nanoCpus: 0, memoryBytes: 0 },
    }
  }

  override async info(): Promise<{ cpus: number; memoryBytes: number }> {
    return { cpus: 64, memoryBytes: 1024 ** 4 }
  }

  override async listNetworks(): Promise<{ id: string; name: string; labels: Record<string, string> }[]> {
    return [{ id: 'net', name: 'atlas-net-stub', labels: {} }]
  }

  override async startContainer(): Promise<void> {
    this.running = true
  }

  override async createExec(args: CreatedExec & { containerId: string }): Promise<{ id: string }> {
    if (this.failNextCreate !== null) {
      const error = this.failNextCreate
      this.failNextCreate = null
      throw error
    }
    this.created.push({ cmd: args.cmd, cwd: args.cwd, env: args.env })
    return { id: `exec-${this.created.length}` }
  }

  override async inspectExec(): Promise<ExecState> {
    return { running: false, exitCode: 0 }
  }

  override async startExec(args: { execId: string; detach?: boolean }): Promise<ReadableStream<Uint8Array>> {
    this.started.push({ execId: args.execId, detach: args.detach })
    return new ReadableStream({ start: (controller) => controller.close() })
  }
}

class RecordingProcesses extends LocalProcessPort {
  readonly launched: SpawnCommand[] = []

  override spawn(): LocalProcessHandle {
    throw new Error('launchDetached must not spawn a tracked process')
  }

  override async launchDetached(args: SpawnCommand): Promise<void> {
    this.launched.push(args)
  }
}

class PlainProcesses implements ProcessPort {
  spawn(): ProcessHandle {
    throw new Error('not used')
  }

  which(): string | null {
    return null
  }
}

const locationOf = (threadId: ThreadId | undefined): EExecutionLocation =>
  threadId === DOCKER_THREAD ? EExecutionLocation.Docker : EExecutionLocation.Host

describe('LocalProcessPort.launchDetached', () => {
  it('starts a process that outlives the call and needs no pipes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-detached-'))
    try {
      const marker = join(directory, 'marker')
      await new LocalProcessPort().launchDetached({
        cmd: ['sh', '-c', 'sleep 0.2; printf %s "$ATLAS_DETACHED_PROBE" > "$1"', 'sh', marker],
        cwd: directory,
        env: { PATH: process.env.PATH, ATLAS_DETACHED_PROBE: 'ran' },
      })

      await expect(readFile(marker, 'utf8')).rejects.toThrow()
      const deadline = Date.now() + 5_000
      let written = ''
      while (written === '' && Date.now() < deadline) {
        written = await readFile(marker, 'utf8').catch(() => '')
        if (written === '') await Bun.sleep(25)
      }
      expect(written).toBe('ran')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('LoginEnvProcessPort.launchDetached', () => {
  it('forwards the command untouched to the inner port', async () => {
    const inner = new RecordingProcesses()
    const command: SpawnCommand = { cmd: ['bun', 'x.js'], cwd: '/tmp', env: { A: '1' } }

    await new LoginEnvProcessPort(inner).launchDetached(command)

    expect(inner.launched).toEqual([command])
  })
})

describe('RoutedProcessPort.launchDetached', () => {
  const routed = (args: { local: ProcessPort; docker: ProcessPort }): RoutedProcessPort =>
    new RoutedProcessPort({ local: args.local, docker: () => args.docker, locationOf })

  it('sends a host thread to the local port and a docker thread to the docker port', async () => {
    const local = new RecordingProcesses()
    const docker = new RecordingProcesses()
    const port = routed({ local, docker })

    await port.launchDetached({ cmd: ['a'], cwd: '/w', threadId: HOST_THREAD })
    await port.launchDetached({ cmd: ['b'], cwd: '/w', threadId: DOCKER_THREAD })

    expect(local.launched.map((one) => one.cmd)).toEqual([['a']])
    expect(docker.launched.map((one) => one.cmd)).toEqual([['b']])
  })

  it('strips NODE_ENV for docker only', async () => {
    const local = new RecordingProcesses()
    const docker = new RecordingProcesses()
    const port = routed({ local, docker })
    const env = { NODE_ENV: 'production', KEEP: 'yes' }

    await port.launchDetached({ cmd: ['a'], cwd: '/w', env, threadId: DOCKER_THREAD })
    await port.launchDetached({ cmd: ['a'], cwd: '/w', env, threadId: HOST_THREAD })

    expect(docker.launched[0]?.env).toEqual({ KEEP: 'yes' })
    expect(local.launched[0]?.env).toEqual(env)
  })

  it('refuses plainly when the chosen port cannot launch detached', async () => {
    const port = routed({ local: new PlainProcesses(), docker: new RecordingProcesses() })

    await expect(port.launchDetached({ cmd: ['a'], cwd: '/w', threadId: HOST_THREAD })).rejects.toThrow(
      'cannot launch detached',
    )
  })
})

describe('DockerProcessPort.launchDetached', () => {
  const dockerPort = (engine: RecordingEngine): DockerProcessPort =>
    new DockerProcessPort({ engine, sandbox: sandboxConfig(), dockerCli: null })

  it('execs the command as given with detach and no pid wrapper, without tracking it', async () => {
    const engine = new RecordingEngine()

    await dockerPort(engine).launchDetached({
      cmd: ['bun', '/home/operator/.atlas/bin/supervisor.js', '/home/operator/.atlas/sessions/s/config.json'],
      cwd: '/work',
      env: { PATH: '/usr/bin', FOO: 'bar' },
    })

    const index = engine.created.findIndex((one) => one.cmd[0] === 'bun')
    expect(index).toBeGreaterThanOrEqual(0)
    expect(engine.created[index]?.cmd).toEqual([
      'bun',
      '/home/operator/.atlas/bin/supervisor.js',
      '/home/operator/.atlas/sessions/s/config.json',
    ])
    expect(engine.created[index]?.cwd).toBe('/work')
    expect(engine.created[index]?.env.FOO).toBe('bar')
    expect(engine.started.at(-1)).toEqual({ execId: `exec-${index + 1}`, detach: true })
    expect(engine.created.filter((one) => one.cmd.includes('printf')).length).toBe(0)
  })

  it('restarts a sandbox that stopped behind its back and retries once', async () => {
    const engine = new RecordingEngine()
    const port = dockerPort(engine)
    await port.launchDetached({ cmd: ['true'], cwd: '/work' })

    const before = engine.created.length
    engine.running = false
    engine.failNextCreate = new EngineRequestFailed({ status: 409, message: 'Container c1 is not running' })
    await port.launchDetached({ cmd: ['true-again'], cwd: '/work' })

    expect(engine.created.slice(before).filter((one) => one.cmd[0] === 'true-again')).toHaveLength(1)
    expect(engine.started.at(-1)?.detach).toBe(true)
  })
})
