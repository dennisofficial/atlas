import { describe, expect, it } from 'bun:test'

import {
  toThreadId,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
  type ThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { BrowserTool } from '../browser'

const THREAD = toThreadId('thread-1')

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

class FakeProcesses implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  readonly probed: { command: string; threadId?: ThreadId | undefined }[] = []

  constructor(
    private readonly binary: string | null,
    private readonly stdout = '',
    private readonly stderr = '',
    private readonly exitCode = 0,
  ) {}

  which(args: { command: string; threadId?: ThreadId | undefined }): string | null {
    this.probed.push(args)
    return args.command === 'agent-browser' ? this.binary : null
  }

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    return {
      stdout: streamOf(this.stdout),
      stderr: streamOf(this.stderr),
      exited: Promise.resolve(this.exitCode),
      terminate: () => undefined,
    }
  }
}

class HangingProcesses implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  readonly ready: Promise<void>
  terminated = 0
  private release: (() => void) | null = null
  private resolveExited: ((code: number) => void) | null = null

  constructor() {
    this.ready = new Promise((resolve) => {
      this.release = resolve
    })
  }

  which(): string | null {
    return '/usr/local/bin/agent-browser'
  }

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    this.release?.()

    let out: ReadableStreamDefaultController<Uint8Array> | undefined
    let err: ReadableStreamDefaultController<Uint8Array> | undefined

    return {
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          out = controller
        },
      }),
      stderr: new ReadableStream<Uint8Array>({
        start(controller) {
          err = controller
        },
      }),
      exited: new Promise<number>((resolve) => {
        this.resolveExited = resolve
      }),
      terminate: () => {
        this.terminated += 1
        out?.close()
        err?.close()
        this.resolveExited?.(137)
      },
    }
  }
}

const runWith = (
  processes: ProcessPort,
  args: readonly string[] = ['open', 'example.com'],
  signal: AbortSignal = new AbortController().signal,
): Promise<ToolOutcome> =>
  new BrowserTool(processes).invoke({
    input: { args },
    signal,
    idempotencyKey: 'browser-tool',
    projectDirectory: '/work',
    threadId: THREAD,
  })

describe('BrowserTool', () => {
  it('spawns the found binary under this thread session, with the arguments as given', async () => {
    const processes = new FakeProcesses('/usr/local/bin/agent-browser', 'opened')

    const outcome = await runWith(processes)

    expect(outcome.ok).toBe(true)
    expect(processes.probed[0]?.command).toBe('agent-browser')
    expect(processes.spawned[0]?.cmd).toEqual([
      '/usr/local/bin/agent-browser',
      '--session',
      'atlas-thread-1',
      'open',
      'example.com',
    ])
    expect(processes.spawned[0]?.threadId).toBe(THREAD)
    expect(processes.spawned[0]?.cwd).toBe('/work')
  })

  it('refuses an agent-supplied session flag without spawning anything', async () => {
    const processes = new FakeProcesses('/usr/local/bin/agent-browser')

    const longFlag = await runWith(processes, ['--session', 'shared', 'open', 'example.com'])
    const shortFlag = await runWith(processes, ['open', 'example.com', '-s', 'shared'])

    expect(longFlag.ok).toBe(false)
    expect(shortFlag.ok).toBe(false)
    if (longFlag.ok || shortFlag.ok) throw new Error('unreachable')
    expect(longFlag.reason).toContain('atlas-thread-1')
    expect(shortFlag.reason).toContain('-s')
    expect(processes.spawned).toHaveLength(0)
  })

  it('names how to install the CLI when it is missing', async () => {
    const processes = new FakeProcesses(null)

    const outcome = await runWith(processes)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.reason).toContain('agent-browser install')
    expect(processes.spawned).toHaveLength(0)
  })

  it('surfaces stderr and the exit code when the command fails', async () => {
    const processes = new FakeProcesses(
      '/usr/local/bin/agent-browser',
      '',
      'error: no browser for that session\n',
      1,
    )

    const outcome = await runWith(processes)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.reason).toContain('exited 1')
    expect(outcome.reason).toContain('no browser for that session')
  })

  it('truncates a long page to the head and the tail with the dropped count', async () => {
    const stdout = 'a'.repeat(30_000)
    const processes = new FakeProcesses('/usr/local/bin/agent-browser', stdout, '', 0)

    const outcome = await runWith(processes)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.output).toMatchObject({
      exitCode: 0,
      truncated: true,
      args: ['open', 'example.com'],
    })
    expect(outcome.modelText).toContain('10000 characters dropped')
    expect(outcome.modelText.length).toBeLessThan(stdout.length)
    expect(outcome.modelText).toContain('a'.repeat(4_000))
  })

  it('envelopes page text as untrusted data, naming the command it came from', async () => {
    const processes = new FakeProcesses(
      '/usr/local/bin/agent-browser',
      '- link "Learn more" [ref=e1]\n',
    )

    const outcome = await runWith(processes, ['snapshot', '-i'])

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.modelText).toContain('<system-untrusted source="agent-browser snapshot -i">')
    expect(outcome.modelText).toContain('[ref=e1]')
  })

  it('reports a timeout instead of passing off the killed command as a result', async () => {
    const processes = new HangingProcesses()

    const outcome = await new BrowserTool(processes).invoke({
      input: { args: ['open', 'slow.example'], timeoutMs: 5 },
      signal: new AbortController().signal,
      idempotencyKey: 'browser-timeout',
      projectDirectory: '/work',
      threadId: THREAD,
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.reason).toContain('did not finish within 5ms')
    expect(processes.terminated).toBe(1)
  })

  it('terminates the running command when the signal aborts', async () => {
    const processes = new HangingProcesses()
    const controller = new AbortController()

    const running = runWith(processes, ['open', 'example.com'], controller.signal)
    await processes.ready
    controller.abort()
    await running

    expect(processes.terminated).toBe(1)
  })
})
