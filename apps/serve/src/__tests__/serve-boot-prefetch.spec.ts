import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { API_PROVISIONED_ENV } from '@dltech/atlas-wire'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { bootServeFiles } from '../serve-boot'

import { fakeServeApp } from './fakes'
import { inMemoryContextFiles } from './serve-spec-fixture'
import { trpcFailure, trpcOk, trpcProcedureOf } from './trpc-fake'

const API = 'https://api.example.com'
const threadId = toThreadId('thread-prefetch')
const homes: string[] = []
const running: ServeHandle[] = []

afterEach(async () => {
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-prefetch-'))
  homes.push(home)
  return home
}

const deferred = () => {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40))

const recordingFetch = (args: {
  seen: string[]
  delays?: Record<string, number>
  reject?: string
}): typeof fetch =>
  (async (input: string | URL | Request) => {
    const procedure = trpcProcedureOf(String(input).split('?')[0] ?? '')
    args.seen.push(procedure)
    await new Promise((resolve) => setTimeout(resolve, args.delays?.[procedure] ?? 0))
    if (procedure === args.reject) throw new TypeError('socket closed')
    if (procedure === 'sandboxSelf.bootSteps') return trpcOk(undefined)
    if (procedure === 'threadEvents.read') return trpcOk([])
    return trpcFailure({ status: procedure === 'publishedBundles.current' ? 404 : 500 })
  }) as unknown as typeof fetch

const bootFiles = (args: {
  fetchFn: typeof fetch
  clone: () => Promise<void>
  lines: ServeLogLine[]
}) => {
  const home = scratchHome()
  return bootServeFiles({
    env: {},
    threadId,
    cwd: home,
    atlasHome: home,
    log: (line) => args.lines.push(line),
    ensureWorkspace: async () => {
      await args.clone()
      return { state: EWorkspaceState.Skipped }
    },
    contextFiles: inMemoryContextFiles(),
    controlPlaneUrl: API,
    token: 'pod-token',
    clientVersion: 'dev',
    fetchFn: args.fetchFn,
  })
}

const eventsOf = (lines: readonly ServeLogLine[]): string[] => lines.map((line) => line.event)

describe('serve boot prefetch', () => {
  it('starts every control-plane fetch before the clone resolves', async () => {
    const seen: string[] = []
    const gate = deferred()
    const booting = bootFiles({
      fetchFn: recordingFetch({ seen }),
      clone: () => gate.promise,
      lines: [],
    })

    await settle()
    const beforeClone = [...seen]
    gate.release()
    await booting

    for (const procedure of [
      'sshSigningKey.lease',
      'accountLease.get',
      'sandboxConfig.get',
      'publishedBundles.current',
      'userFiles.get',
    ]) {
      expect(beforeClone).toContain(procedure)
    }
  })

  it('applies in the old order however the fetches finish', async () => {
    const lines: ServeLogLine[] = []
    await bootFiles({
      fetchFn: recordingFetch({
        seen: [],
        delays: { 'userFiles.get': 0, 'publishedBundles.current': 10, 'sshSigningKey.lease': 30 },
      }),
      clone: async () => undefined,
      lines,
    })

    const applied = eventsOf(lines).filter((event) =>
      [
        EServeEvent.WorkspaceReady,
        EServeEvent.SigningKeyAbsent,
        EServeEvent.CloudStateFailed,
        EServeEvent.BundleAbsent,
        EServeEvent.InstructionsFailed,
      ].includes(event as EServeEvent),
    )
    expect(applied).toEqual([
      EServeEvent.WorkspaceReady,
      EServeEvent.SigningKeyAbsent,
      EServeEvent.CloudStateFailed,
      EServeEvent.BundleAbsent,
      EServeEvent.InstructionsFailed,
    ])
  })

  it('surfaces a prefetch failure at its own step without an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', record)
    try {
      const lines: ServeLogLine[] = []
      const gate = deferred()
      const booting = bootFiles({
        fetchFn: recordingFetch({ seen: [], reject: 'userFiles.get' }),
        clone: () => gate.promise,
        lines,
      })
      await settle()
      expect(eventsOf(lines)).not.toContain(EServeEvent.InstructionsFailed)
      gate.release()
      await booting
      await settle()

      const events = eventsOf(lines)
      expect(events.indexOf(EServeEvent.InstructionsFailed)).toBeGreaterThan(
        events.indexOf(EServeEvent.WorkspaceReady),
      )
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', record)
    }
  })

  it('logs a boot-phase timing for each phase', async () => {
    const lines: ServeLogLine[] = []
    await bootFiles({ fetchFn: recordingFetch({ seen: [] }), clone: async () => undefined, lines })

    const phases = lines
      .filter((line) => line.event === EServeEvent.BootPhase)
      .map((line) => [line.phase, typeof line.ms])
    expect(phases).toEqual([
      ['clone', 'number'],
      ['setup', 'number'],
      ['signing', 'number'],
      ['settings', 'number'],
      ['context', 'number'],
    ])
  })

  it('starts the thread model read but not the history read before the clone resolves, and logs hydrate and compose', async () => {
    const seen: string[] = []
    const lines: string[] = []
    const gate = deferred()
    const home = scratchHome()
    const held = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = home
    try {
      const starting = startServe({
        threadId,
        port: 0,
        token: 'serve-token',
        controlPlaneUrl: API,
        env: { [API_PROVISIONED_ENV]: '1' },
        cwd: '/workspace',
        write: (line) => lines.push(line),
        compose: async () => fakeServeApp({ threadId, root: '/workspace' }),
        ensureWorkspace: async () => {
          await gate.promise
          return { state: EWorkspaceState.Skipped }
        },
        contextFiles: inMemoryContextFiles(),
        fetchFn: recordingFetch({ seen }),
      })
      await settle()
      const beforeClone = [...seen]
      gate.release()
      running.push(await starting)

      expect(beforeClone).not.toContain('threadEvents.read')
      expect(beforeClone).toContain('threads.get')
      const phases = lines
        .filter((line) => line.includes(EServeEvent.BootPhase))
        .map((line) => JSON.parse(line).phase)
      expect(phases).toContain('hydrate')
      expect(phases).toContain('compose')
    } finally {
      if (held === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = held
    }
  })
})
