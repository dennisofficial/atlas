import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EKilledBy, EShellStatus, type ThreadId } from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { CountingIds, SteppingClock } from '../../store/__tests__/harness'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { SessionRegistry } from '../../store/sessions/registry'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import { EInspected, type ShellAttachment, type ShellExit, type InspectedShell } from '../port'
import { toShellId } from '../shell-id'
import { BunShellRegistry } from '../shell-registry'

const fixtures: { home: string; shells: BunShellRegistry }[] = []

afterEach(async () => {
  for (const { home, shells } of fixtures.splice(0)) {
    await shells.detachAll()
    await rm(home, { recursive: true, force: true })
  }
})

export async function familyRecoveryFixture() {
  const home = await mkdtemp(join(tmpdir(), 'atlas-family-recovery-'))
  const ids = new CountingIds('family')
  const clock = new SteppingClock()
  const sessions = new SessionRegistry(home)
  const log = new JsonlEventLog(home, sessions, clock, ids)
  const threads = new JsonlThreadStore(home, sessions, clock, ids, log)
  const root = await threads.create({ title: 'root' })
  const child = await threads.create({ agent: { spawnedBy: root.id, type: 'explore' } })
  const teammate = await threads.create({ agent: { spawnedBy: root.id, type: 'teammate' } })
  const grandchild = await threads.create({ agent: { spawnedBy: teammate.id, type: 'explore' } })
  const stranger = await threads.create({ title: 'another session' })
  const inspected: ThreadId[] = []
  const attachments = new Map<ThreadId, InspectedShell>()
  const exits = new Map<ThreadId, (exit: ShellExit) => void>()
  const killed: ThreadId[] = []
  let ignoreKills = false
  const seed = async (threadId: ThreadId) => {
    const shellId = toShellId(`shell_${threadId}`)
    const attachment: ShellAttachment = {
      shellId,
      startedAt: '2026-09-24T00:00:00.000Z',
      outputPath: join(home, `${shellId}.out`),
      cursorPath: join(home, `${shellId}.cursor`),
      inputSupported: false,
      totalBytes: () => 0,
      readOutput: async () => new Uint8Array(),
      writeInput: async () => ({ ok: false, reason: 'unsupported' }),
      kill: (by) => {
        killed.push(threadId)
        if (!ignoreKills) exits.get(threadId)?.({ status: EShellStatus.Killed, killedBy: by, totalBytes: 0 })
      },
      watch: ({ onExit }) => { exits.set(threadId, onExit) },
      detach: async () => undefined,
    }
    attachments.set(threadId, { state: EInspected.Live, shellId, attachment })
    await log.append({
      threadId,
      runId: ids.nextRunId(),
      drafts: [{ type: 'background-shell-started', shellId, bootId: 'previous-boot', command: 'task', description: 'task' }],
    })
  }
  const shells = new BunShellRegistry({
    root: home,
    clock,
    hooks: () => new HookChain({}),
    log,
    ids,
    threads,
    launcher: {
      launch: async () => ({ ok: false, reason: 'recovery only' }),
      inspect: async ({ threadId }) => {
        inspected.push(threadId)
        const found = attachments.get(threadId)
        return found === undefined ? [] : [found]
      },
    },
  })
  fixtures.push({ home, shells })
  return {
    root: root.id, child: child.id, teammate: teammate.id, grandchild: grandchild.id,
    stranger: stranger.id, shells, log, threads, seed, inspected, killed,
    refuseKills: () => { ignoreKills = true },
    finish: (threadId: ThreadId) => exits.get(threadId)?.({ status: EShellStatus.Exited, exitCode: 0, totalBytes: 0 }),
  }
}

describe('family shell recovery', () => {
  it('observes stored descendants when only their parent reopens, and ends in each owner log', async () => {
    const f = await familyRecoveryFixture()
    for (const owner of [f.child, f.teammate, f.grandchild, f.stranger]) await f.seed(owner)

    await Promise.all([f.shells.reconcile({ threadId: f.root }), f.shells.reconcile({ threadId: f.root })])

    expect(f.inspected.sort()).toEqual([f.child, f.teammate, f.grandchild].sort())
    expect(f.shells.listEverywhere().map((shell) => shell.threadId).sort()).toEqual([f.child, f.teammate, f.grandchild].sort())
    const ended = new Promise<void>((resolve) => {
      const unsubscribe = f.shells.subscribe(() => {
        if (f.shells.list({ threadId: f.child })[0]?.status === EShellStatus.Running) return
        unsubscribe()
        resolve()
      })
    })
    f.finish(f.child)
    await ended
    await f.shells.awaitEndings({ threadId: f.child, ms: 1000 })
    expect((await f.log.readOwn({ threadId: f.child })).filter((event) => event.type === 'background-shell-ended')).toHaveLength(1)
    expect(await f.log.readOwn({ threadId: f.root })).toEqual([])
    expect(f.shells.pendingNotices({ threadId: f.root })).toEqual([])
    expect(f.shells.pendingNotices({ threadId: f.child })).toHaveLength(1)
    for (const owner of [f.teammate, f.grandchild]) {
      await f.shells.stopOwners({ threadIds: [owner], by: EKilledBy.SessionEnd, ms: 1000 })
      expect((await f.log.readOwn({ threadId: owner })).filter((event) => event.type === 'background-shell-ended')).toHaveLength(1)
      expect(f.shells.pendingNotices({ threadId: owner })).toHaveLength(1)
    }
    expect(await f.log.readOwn({ threadId: f.root })).toEqual([])
  })

  it('cold close uses its explicit family fence without sweeping unrelated sessions', async () => {
    const f = await familyRecoveryFixture()
    for (const owner of [f.child, f.teammate, f.grandchild, f.stranger]) await f.seed(owner)
    await f.shells.closeAll({ threadId: f.root, killedBy: EKilledBy.SessionEnd })
    expect(f.killed.sort()).toEqual([f.child, f.teammate, f.grandchild].sort())
    expect(f.inspected).not.toContain(f.stranger)
    expect((await f.log.readOwn({ threadId: f.stranger })).map((event) => event.type)).toEqual(['background-shell-started'])
  })

  it('normal close discovers descendants of an admitted owner', async () => {
    const f = await familyRecoveryFixture()
    await f.shells.reconcile({ threadId: f.root })
    await f.seed(f.child)
    await f.shells.closeAll()
    expect(f.killed).toEqual([f.child])
  })

  it('reconciliation traverses cyclic lineage once per owner', async () => {
    const f = await familyRecoveryFixture()
    await f.seed(f.grandchild)
    const rootSummary = await f.threads.find({ threadId: f.root })
    if (rootSummary === undefined) throw new Error('missing root')
    const spawned = f.threads.spawned.bind(f.threads)
    const visited: ThreadId[] = []
    f.threads.spawned = async (args) => {
      visited.push(args.threadId)
      return args.threadId === f.grandchild ? [rootSummary] : spawned(args)
    }
    await f.shells.reconcile({ threadId: f.root })
    expect(new Set(visited).size).toBe(4)
    expect(visited).toHaveLength(4)
    expect(f.inspected).toEqual([f.grandchild])
  })

  it('a registry with no known owners does not sweep disk during close', async () => {
    const f = await familyRecoveryFixture()
    await f.seed(f.child)
    await f.shells.closeAll()
    expect(f.inspected).toEqual([])
    expect(f.killed).toEqual([])
  })
})
