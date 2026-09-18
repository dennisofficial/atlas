import { describe, expect, it } from 'bun:test'

import { DockerProcessPort } from '../docker-process'
import {
  DockerEngine,
  type ContainerDetails,
  type ContainerSummary,
  type ExecState,
} from '../engine'
import { EExecStream } from '../frames'
import { sandboxCreateBody, type SandboxConfig } from '../sandbox'

const CONTAINER_ID = 'atlas-dev-stub-container'

const config = (): SandboxConfig => ({
  image: 'node:22-slim',
  worktree: '/work',
  session: 'session-test',
  uid: 501,
  gid: 20,
  home: '/home/operator',
  limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
  dockerSocket: '/var/run/docker.sock',
})

const stampedLabels = (): Record<string, string> => sandboxCreateBody(config()).Labels ?? {}

const frame = (stream: EExecStream, payload: Uint8Array): Uint8Array => {
  const out = new Uint8Array(8 + payload.length)
  const view = new DataView(out.buffer)
  view.setUint8(0, stream)
  view.setUint32(4, payload.length, false)
  out.set(payload, 8)
  return out
}

const collectText = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    if (value !== undefined) text += decoder.decode(value, { stream: true })
  }
}

class OutputLossEngine extends DockerEngine {
  readonly execs: { cmd: readonly string[] }[] = []
  detachedStarts = 0
  inspections = 0
  exitsAfter = Number.POSITIVE_INFINITY
  exitCode = 7
  inspectError: Error | null = null

  constructor() {
    super({ socketPath: '/atlas-dev-stub.sock' })
  }

  override async listContainers(): Promise<ContainerSummary[]> {
    return [{ id: CONTAINER_ID, name: 'atlas-dev-stub', state: 'running', labels: {} }]
  }

  override async inspectContainer(): Promise<ContainerDetails> {
    return {
      id: CONTAINER_ID,
      name: 'atlas-dev-stub',
      state: { running: true },
      config: { labels: stampedLabels(), env: ['PATH=/usr/local/bin'], image: 'node:22-slim' },
      mounts: [],
      ports: [],
      hostConfig: { nanoCpus: 0, memoryBytes: 0 },
    }
  }

  override async info(): Promise<{ cpus: number; memoryBytes: number }> {
    return { cpus: 64, memoryBytes: 1024 ** 4 }
  }

  override async createExec(args: { cmd: readonly string[] }): Promise<{ id: string }> {
    this.execs.push(args)
    const isMain = args.cmd.some((part) => part.includes('atlas-exec-'))
    return { id: isMain ? 'exec-main' : `exec-${this.execs.length}` }
  }

  override async startExec(args: { execId: string; detach?: boolean }): Promise<ReadableStream<Uint8Array>> {
    if (args.detach === true) {
      this.detachedStarts += 1
      return new ReadableStream({ start: (controller) => controller.close() })
    }
    if (args.execId !== 'exec-main') {
      return new ReadableStream({ start: (controller) => controller.close() })
    }

    const said = frame(EExecStream.Stdout, new TextEncoder().encode('serving on 3001\n'))
    let delivered = false
    return new ReadableStream({
      pull(controller) {
        if (!delivered) {
          delivered = true
          controller.enqueue(said)
          return
        }
        controller.error(new Error('The operation timed out'))
      },
    })
  }

  override async inspectExec(args: { execId: string }): Promise<ExecState> {
    if (args.execId !== 'exec-main') return { running: false, exitCode: 0 }
    this.inspections += 1
    if (this.inspectError !== null) throw this.inspectError
    if (this.inspections < this.exitsAfter) return { running: true, exitCode: null }
    return { running: false, exitCode: this.exitCode }
  }
}

const spawnServer = (engine: OutputLossEngine) => {
  const port = new DockerProcessPort({ engine, sandbox: config(), dockerCli: null })
  return port.spawn({ cmd: ['next', 'dev'], cwd: '/work' })
}

describe('DockerProcessPort when the exec output stream dies mid-run', () => {
  it('keeps tracking the process and reports its real exit code', async () => {
    const engine = new OutputLossEngine()
    engine.exitsAfter = 3
    engine.exitCode = 7
    const handle = spawnServer(engine)

    const heard = collectText(handle.stderr)
    expect(await handle.exited).toBe(7)
    const stderr = await heard
    expect(stderr).toContain('lost the connection')
    expect(stderr).toContain('still running')
  })

  it('can still kill the process after the output stream is gone', async () => {
    const engine = new OutputLossEngine()
    const handle = spawnServer(engine)

    const heard = collectText(handle.stderr)
    handle.terminate()
    engine.exitsAfter = engine.inspections + 2

    expect(await handle.exited).toBe(7)
    await heard
    const killScript = engine.execs.find((exec) => exec.cmd.some((part) => part.includes('kill -TERM')))
    expect(killScript).toBeDefined()
    expect(engine.detachedStarts).toBe(1)
  })

  it('ends quietly with the real exit code when the process died with its stream', async () => {
    const engine = new OutputLossEngine()
    engine.exitsAfter = 0
    engine.exitCode = 0
    const handle = spawnServer(engine)

    const heard = collectText(handle.stderr)
    expect(await handle.exited).toBe(0)
    expect(await heard).toBe('')
  })

  it('rejects the exit when the daemon can no longer say whether the process lives', async () => {
    const engine = new OutputLossEngine()
    engine.inspectError = new Error('daemon socket vanished')
    const handle = spawnServer(engine)

    await expect(handle.exited).rejects.toThrow('daemon socket vanished')
  })
})
