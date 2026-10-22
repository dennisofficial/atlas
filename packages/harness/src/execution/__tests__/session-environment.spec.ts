import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ProcessPort,
  toThreadId,
  type ProcessHandle,
  type SpawnCommand,
} from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../store/__tests__/harness'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { contextDirectory, sessionDirectory, threadDataDirectory } from '../../store/sessions/paths'
import { SessionRegistry } from '../../store/sessions/registry'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import {
  ATLAS_CONTEXT_DIR_ENV,
  ATLAS_SESSION_DIR_ENV,
  ATLAS_THREAD_DIR_ENV,
  SessionEnvironmentProcessPort,
} from '../session-environment'

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

class RecordingProcesses extends ProcessPort {
  readonly spawned: SpawnCommand[] = []
  readonly detached: SpawnCommand[] = []
  terminated = 0

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    return {
      stdout: streamOf('out'),
      stderr: streamOf(''),
      exited: Promise.resolve(0),
      terminate: () => {
        this.terminated += 1
      },
    }
  }

  override async launchDetached(args: SpawnCommand): Promise<void> {
    this.detached.push(args)
  }

  which(): string | null {
    return '/bin/which'
  }
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'atlas-session-env-'))
  homes.push(home)
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  const threads = new JsonlThreadStore(home, registry, clock, ids, log)
  const inner = new RecordingProcesses()
  const port = new SessionEnvironmentProcessPort({ inner, sessions: registry })
  return { home, registry, threads, inner, port }
}

const run = async (handle: ProcessHandle): Promise<string> => {
  await handle.exited
  return await new Response(handle.stdout).text()
}

describe('SessionEnvironmentProcessPort', () => {
  it('gives main, sub-agent and teammate the root session dir and their own thread dir', async () => {
    const { home, threads, inner, port } = await fixture()
    const main = await threads.create({ title: 'main' })
    const sub = await threads.create({ agent: { spawnedBy: main.id, type: 'explore' } })
    const mate = await threads.create({ agent: { spawnedBy: sub.id, type: 'teammate' } })
    const sessionDir = sessionDirectory({ home, sessionId: main.id })

    for (const thread of [main, sub, mate]) {
      expect(await run(port.spawn({ cmd: ['x'], cwd: '/', env: {}, threadId: thread.id }))).toBe('out')
    }

    expect(inner.spawned.map((one) => one.env?.[ATLAS_SESSION_DIR_ENV])).toEqual([sessionDir, sessionDir, sessionDir])
    expect(inner.spawned.map((one) => one.env?.[ATLAS_THREAD_DIR_ENV])).toEqual(
      [main, sub, mate].map((thread) => threadDataDirectory({ sessionDir, threadId: thread.id })),
    )
    expect(inner.spawned.map((one) => one.env?.[ATLAS_CONTEXT_DIR_ENV])).toEqual(
      [sessionDir, sessionDir, sessionDir].map((dir) => contextDirectory({ sessionDir: dir })),
    )
    expect((await stat(threadDataDirectory({ sessionDir, threadId: mate.id }))).isDirectory()).toBe(true)
    expect((await stat(contextDirectory({ sessionDir }))).isDirectory()).toBe(true)
  })

  it('keeps concurrent spawns for different threads separate', async () => {
    const { threads, inner, port } = await fixture()
    const first = await threads.create({ title: 'a' })
    const second = await threads.create({ title: 'b' })

    await Promise.all(
      [first, second].map((thread) =>
        run(port.spawn({ cmd: ['x'], cwd: '/', env: {}, threadId: thread.id })),
      ),
    )

    const byThread = new Map(inner.spawned.map((one) => [one.threadId, one.env?.[ATLAS_THREAD_DIR_ENV]]))
    expect(byThread.get(first.id)).toContain(first.id)
    expect(byThread.get(second.id)).toContain(second.id)
    expect(byThread.get(first.id)).not.toBe(byThread.get(second.id))
  })

  it('overrides caller-supplied reserved variables and keeps the rest', async () => {
    const { threads, inner, port } = await fixture()
    const main = await threads.create({ title: 'main' })

    await run(
      port.spawn({
        cmd: ['x'],
        cwd: '/',
        env: {
          [ATLAS_SESSION_DIR_ENV]: '/evil',
          [ATLAS_THREAD_DIR_ENV]: '/evil',
          [ATLAS_CONTEXT_DIR_ENV]: '/evil',
          KEEP: '1',
        },
        threadId: main.id,
      }),
    )

    const env = inner.spawned[0]?.env
    expect(env?.KEEP).toBe('1')
    expect(env?.[ATLAS_SESSION_DIR_ENV]).not.toBe('/evil')
    expect(env?.[ATLAS_THREAD_DIR_ENV]).not.toBe('/evil')
    expect(env?.[ATLAS_CONTEXT_DIR_ENV]).not.toBe('/evil')
  })

  it('refuses to run a shell for an unregistered thread and says why, without creating a session', async () => {
    const { home, inner, port } = await fixture()
    const unknown = toThreadId('stranger')

    const handle = port.spawn({ cmd: ['x'], cwd: '/', env: { KEEP: '1' }, threadId: unknown })

    expect(await handle.exited).toBe(127)
    expect(await new Response(handle.stderr).text()).toContain('is not registered in any session')
    expect(inner.spawned).toHaveLength(0)
    expect(await stat(sessionDirectory({ home, sessionId: unknown })).catch(() => null)).toBeNull()
  })

  it('does not run a shell when the thread directory cannot be prepared', async () => {
    const { home, threads, inner, port } = await fixture()
    const main = await threads.create({ title: 'main' })
    const sessionDir = sessionDirectory({ home, sessionId: main.id })
    const outside = await mkdtemp(join(tmpdir(), 'atlas-outside-'))
    homes.push(outside)
    await symlink(outside, threadDataDirectory({ sessionDir, threadId: main.id }))

    const handle = port.spawn({ cmd: ['x'], cwd: '/', env: {}, threadId: main.id })

    expect(await handle.exited).toBe(127)
    expect(await new Response(handle.stderr).text()).toContain('must be a plain directory')
    expect(inner.spawned).toHaveLength(0)
  })

  it('gives a thread-owned spawn without env the sanitized process environment plus the session variables', async () => {
    const { threads, inner, port } = await fixture()
    const main = await threads.create({ title: 'main' })
    process.env[ATLAS_SESSION_DIR_ENV] = '/evil'

    try {
      await run(port.spawn({ cmd: ['x'], cwd: '/', threadId: main.id }))
    } finally {
      delete process.env[ATLAS_SESSION_DIR_ENV]
    }

    const env = inner.spawned[0]?.env
    expect(env?.PATH).toBe(process.env.PATH)
    expect(env?.[ATLAS_SESSION_DIR_ENV]).toContain(main.id)
    expect(env?.[ATLAS_THREAD_DIR_ENV]).toContain(main.id)
  })

  it('leaves a spawn without a thread and without env alone', async () => {
    const { inner, port } = await fixture()

    await run(port.spawn({ cmd: ['x'], cwd: '/' }))

    expect(inner.spawned[0]?.env).toBeUndefined()
  })

  it('launches detached with the session variables after preparing the directories', async () => {
    const { threads, inner, port } = await fixture()
    const main = await threads.create({ title: 'main' })

    await port.launchDetached({ cmd: ['x'], cwd: '/', env: { [ATLAS_THREAD_DIR_ENV]: '/evil' }, threadId: main.id })

    expect(inner.detached[0]?.env?.[ATLAS_THREAD_DIR_ENV]).toContain(main.id)
    expect(inner.detached[0]?.env?.[ATLAS_THREAD_DIR_ENV]).not.toBe('/evil')
  })

  it('rejects a detached launch for an unregistered thread or an inner port that cannot detach', async () => {
    const { threads, inner, registry } = await fixture()
    const main = await threads.create({ title: 'main' })
    const unknown = toThreadId('stranger')
    const detaching = new SessionEnvironmentProcessPort({ inner, sessions: registry })
    const plain = new SessionEnvironmentProcessPort({
      inner: { spawn: inner.spawn.bind(inner), which: inner.which.bind(inner) },
      sessions: registry,
    })

    await expect(detaching.launchDetached({ cmd: ['x'], cwd: '/', threadId: unknown })).rejects.toThrow('not registered')
    await expect(plain.launchDetached({ cmd: ['x'], cwd: '/', threadId: main.id })).rejects.toThrow('cannot launch detached')
    expect(inner.detached).toHaveLength(0)
  })

  it('strips reserved variables when the thread cannot reach session paths', async () => {
    const { threads, inner, registry } = await fixture()
    const main = await threads.create({ title: 'main' })
    const port = new SessionEnvironmentProcessPort({ inner, sessions: registry, reachable: () => false })

    await run(port.spawn({ cmd: ['x'], cwd: '/', env: { [ATLAS_THREAD_DIR_ENV]: '/evil' }, threadId: main.id }))

    expect(inner.spawned[0]?.env).toEqual({})
  })

  it('terminates before the inner spawn without starting anything', async () => {
    const { threads, inner, port } = await fixture()
    const main = await threads.create({ title: 'main' })
    const handle = port.spawn({ cmd: ['x'], cwd: '/', env: {}, threadId: main.id })

    handle.terminate()

    expect(await handle.exited).toBe(143)
    expect(inner.spawned).toHaveLength(0)
  })

  it('forwards terminate and which to the inner port', async () => {
    const { threads, inner, port } = await fixture()
    const main = await threads.create({ title: 'main' })
    const handle = port.spawn({ cmd: ['x'], cwd: '/', env: {}, threadId: main.id })
    await handle.exited
    handle.terminate()

    expect(inner.terminated).toBe(1)
    expect(port.which({ command: 'git' })).toBe('/bin/which')
    expect(await port.vendored({ command: 'rg' })).toBeNull()
    expect((await port.exposePort({ containerPort: 3000 })).ok).toBe(false)
  })
})
