import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EServiceStatus,
  EStopAction,
  toThreadId,
  type ClockPort,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
} from '@dltech/atlas-core'

import { startService, type StartedService } from '../service-process'

const THREAD = toThreadId('thread-under-test')

class FixedClock implements ClockPort {
  now(): string {
    return '2026-09-15T12:00:00.000Z'
  }
}

const streamOf = (chunks: readonly string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })

class FakePort implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  terminated = 0
  exitCode: Promise<number> = new Promise<number>(() => undefined)
  stdoutChunks: readonly string[] = []
  stderrChunks: readonly string[] = []

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    return {
      stdout: streamOf(this.stdoutChunks),
      stderr: streamOf(this.stderrChunks),
      exited: this.exitCode,
      terminate: () => {
        this.terminated += 1
      },
    }
  }

  which(): string | null {
    return null
  }
}

const roots: string[] = []

const open = (args: { port: FakePort; logPath?: string | undefined }): StartedService => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-service-process-'))
  roots.push(root)
  return startService({
    serviceId: 'svc_1',
    command: 'serve --watch',
    description: 'fake dev server',
    cwd: root,
    logPath: args.logPath ?? join(root, 'logs', 'svc_1.deadbeef.log'),
    clock: new FixedClock(),
    processes: args.port,
    threadId: THREAD,
    onExit: () => undefined,
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const untilFileHolds = async (args: { path: string; needles: readonly string[] }): Promise<void> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let log = ''
    try {
      log = readFileSync(args.path, 'utf8')
    } catch {
      log = ''
    }
    if (args.needles.every((needle) => log.includes(needle))) return
    await Bun.sleep(25)
  }
  throw new Error(`log at ${args.path} never held ${args.needles.join(' and ')}`)
}

describe('startService over a ProcessPort', () => {
  it('spawns through the port with the starting thread and pumps both streams into the one log', async () => {
    const port = new FakePort()
    port.stdoutChunks = ['listening on 3000\n']
    port.stderrChunks = ['warning: experimental\n']

    const started = open({ port })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(port.spawned[0]?.threadId).toBe(THREAD)
    expect(port.spawned[0]?.cmd).toEqual(['bash', '-c', 'serve --watch'])

    await untilFileHolds({
      path: started.service.logPath,
      needles: ['listening on 3000', 'warning: experimental'],
    })

    const snapshot = started.service.snapshot()
    expect(snapshot.status).toBe(EServiceStatus.Running)
    expect(snapshot.pid).toBeUndefined()

    started.service.stop(EKilledBy.SessionEnd)
  })

  it('answers a port that throws on spawn with a reason, not a throw', () => {
    const port = new FakePort()
    port.spawn = () => {
      throw new Error('ENOENT: no such directory')
    }

    const started = open({ port })

    expect(started.ok).toBe(false)
    if (started.ok) return
    expect(started.reason).toContain('could not start a service')
    expect(started.reason).toContain('ENOENT')
  })

  it('answers an unopenable log path with a reason, not a throw', () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-service-process-'))
    roots.push(root)
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'a file, not a directory')

    const started = startService({
      serviceId: 'svc_1',
      command: 'serve',
      description: 'nowhere to log',
      cwd: root,
      logPath: join(blocker, 'svc_1.log'),
      clock: new FixedClock(),
      processes: new FakePort(),
      threadId: THREAD,
      onExit: () => undefined,
    })

    expect(started.ok).toBe(false)
    if (started.ok) return
    expect(started.reason).toContain('could not open the service log')
  })

  it('records a quick exit as Exited with its code, the settle-window failure shape', async () => {
    const port = new FakePort()
    port.stdoutChunks = ['doomed\n']
    port.exitCode = Promise.resolve(3)

    const started = open({ port })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await started.service.exited

    const snapshot = started.service.snapshot()
    expect(snapshot.status).toBe(EServiceStatus.Exited)
    expect(snapshot.exitCode).toBe(3)
    expect(snapshot.endedAt).toBe('2026-09-15T12:00:00.000Z')
    await untilFileHolds({ path: started.service.logPath, needles: ['doomed'] })
  })

  it('tolerates the port rejecting its exit promise, ending as Exited without a code', async () => {
    const port = new FakePort()
    port.exitCode = Promise.reject(new Error('sandbox is gone'))

    const started = open({ port })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await started.service.exited

    const snapshot = started.service.snapshot()
    expect(snapshot.status).toBe(EServiceStatus.Exited)
    expect(snapshot.exitCode).toBeUndefined()
  })

  it('stops through the handle and reports the term-then-kill action sequence', async () => {
    const port = new FakePort()

    const started = open({ port })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const first = started.service.stop(EKilledBy.Model)
    expect(first).toBe(EStopAction.Term)
    expect(port.terminated).toBe(1)
    expect(started.service.snapshot().status).toBe(EServiceStatus.Killed)
    expect(started.service.snapshot().killedBy).toBe(EKilledBy.Model)

    const second = started.service.stop(EKilledBy.Model)
    expect(second).toBe(EStopAction.Kill)
    expect(port.terminated).toBe(2)
  })
})
