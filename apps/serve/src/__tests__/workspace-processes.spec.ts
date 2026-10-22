import { describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EServiceStatus,
  EShellStatus,
  toRunId,
  toThreadId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { stopShellOwners } from '../../../../packages/harness/src/shells/lifecycle-operations'
import type { ShellSnapshot } from '../../../../packages/harness/src/shells/background-shell'
import { toShellId } from '../../../../packages/harness/src/shells/shell-id'
import { endFamilyShellsFor, stopWorkspaceProcessesFor } from '../workspace-hooks'

const root = toThreadId('root')
const child = toThreadId('child')
const stranger = toThreadId('stranger')

type FakeShell = { shellId: string; threadId: ThreadId; status: EShellStatus }

const shellOperations = (args: {
  shells: FakeShell[]
  killed: string[]
  killedShellsEnd?: boolean
  straggling?: number
  killReasons?: EKilledBy[]
}) => {
  const snapshotOf = (shell: FakeShell): ShellSnapshot => ({
    ...shell,
    shellId: toShellId(shell.shellId),
    command: 'sleep 30',
    description: 'workspace process',
    startedAt: '2026-09-15T00:00:00.000Z',
    lastOutputAt: '2026-09-15T00:00:00.000Z',
    totalCharacters: 0,
    awaitingInput: false,
  })
  const operations = {
    reconcile: async () => [],
    list: ({ threadId }: { threadId: ThreadId }) =>
      args.shells.filter((shell) => shell.threadId === threadId).map(snapshotOf),
    kill: ({ shellId, threadId, by }: { shellId: string; threadId: ThreadId; by: EKilledBy }) => {
      args.killReasons?.push(by)
      const shell = args.shells.find((candidate) => candidate.shellId === shellId && candidate.threadId === threadId)
      if (shell === undefined) return { ok: false as const, reason: 'unknown shell' }
      args.killed.push(shellId)
      if (args.killedShellsEnd !== false) shell.status = EShellStatus.Killed
      return { ok: true as const, snapshot: snapshotOf(shell) }
    },
    awaitEndings: async () => args.straggling ?? 0,
  }
  return {
    stopOwners: (owners: Parameters<typeof stopShellOwners>[0]['owners']) =>
      stopShellOwners({ shells: operations, owners }),
  }
}

const harness = (args: {
  shells: FakeShell[]
  services?: { serviceId: string; status: EServiceStatus }[]
  killedShellsEnd?: boolean
  straggling?: number
  endings?: Record<string, EventDraft[]>
  killedBy?: EKilledBy
  serviceStragglers?: number
  serviceEnds?: boolean
  appendFailsOnce?: boolean
}) => {
  const killed: string[] = []
  const stopped: string[] = []
  const killReasons: EKilledBy[] = []
  let failAppend = args.appendFailsOnce === true
  const appended: { threadId: ThreadId; drafts: readonly EventDraft[] }[] = []
  const queued = new Map<ThreadId, EventDraft[]>(Object.entries(args.endings ?? {}) as never)
  const services = args.services ?? []
  const stop = stopWorkspaceProcessesFor({
    root,
    ...(args.killedBy === undefined ? {} : { killedBy: args.killedBy }),
    threads: {
      spawned: async ({ threadId }) =>
        threadId === root ? [{ id: child } as never] : [],
    },
    shells: {
      ...shellOperations({ ...args, killed, killReasons }),
      drainNotifications: ({ threadId }) => {
        const drafts = queued.get(threadId) ?? []
        queued.delete(threadId)
        return drafts
      },
    },
    services: {
      list: () => services as never,
      stop: ({ serviceId, by }) => {
        killReasons.push(by)
        stopped.push(serviceId)
        const service = services.find((candidate) => candidate.serviceId === serviceId)
        if (service !== undefined && args.serviceEnds !== false) service.status = EServiceStatus.Killed
        return { ok: true } as never
      },
      awaitEndings: async () => args.serviceStragglers ?? 0,
      drainNotifications: () => [],
    },
    log: {
      append: async (given) => {
        if (failAppend) { failAppend = false; throw new Error('process ending append failed') }
        appended.push({ threadId: given.threadId, drafts: given.drafts })
        return []
      },
    },
    ids: { nextRunId: () => toRunId('run-stop') },
  })
  return { stop, killed, stopped, appended, killReasons }
}

describe('stopping the workspace processes before a capture', () => {
  it('attributes both shells and services to the requested rotation', async () => {
    const test = harness({
      shells: [{ shellId: 'a', threadId: root, status: EShellStatus.Running }],
      services: [{ serviceId: 'svc', status: EServiceStatus.Running }],
      killedBy: EKilledBy.Rotation,
    })
    await test.stop()
    expect(test.killReasons).toEqual([EKilledBy.Rotation, EKilledBy.Rotation])
  })

  for (const unresolved of [{ serviceEnds: false }, { serviceStragglers: 1 }]) {
    it(`refuses a service that has not confirmed its ending: ${JSON.stringify(unresolved)}`, async () => {
      const test = harness({ shells: [], services: [{ serviceId: 'svc', status: EServiceStatus.Running }], ...unresolved })
      await expect(test.stop()).rejects.toThrow('background processes are still writing')
      expect(test.appended).toEqual([])
    })
  }

  it('retries an append without losing the drained process ending', async () => {
    const ended = { type: 'shell-ended', shellId: 'a' } as unknown as EventDraft
    const test = harness({
      shells: [{ shellId: 'a', threadId: root, status: EShellStatus.Running }],
      endings: { root: [ended] }, appendFailsOnce: true,
    })
    await expect(test.stop()).rejects.toThrow('process ending append failed')
    await test.stop()
    expect(test.appended).toEqual([{ threadId: root, drafts: [ended] }])
  })

  it('kills only the shells the session family owns', async () => {
    const { stop, killed } = harness({
      shells: [
        { shellId: 'a', threadId: root, status: EShellStatus.Running },
        { shellId: 'b', threadId: child, status: EShellStatus.Running },
        { shellId: 'c', threadId: stranger, status: EShellStatus.Running },
      ],
    })

    await stop()

    expect(killed.sort()).toEqual(['a', 'b'])
  })

  it('stops running services too', async () => {
    const { stop, stopped } = harness({
      shells: [],
      services: [{ serviceId: 'svc', status: EServiceStatus.Running }],
    })

    await stop()

    expect(stopped).toEqual(['svc'])
  })

  it('refuses the capture when a shell is still running after the kill', async () => {
    const { stop } = harness({
      shells: [{ shellId: 'a', threadId: root, status: EShellStatus.Running }],
      killedShellsEnd: false,
    })

    await expect(stop()).rejects.toThrow('background shells have not stopped')
  })

  it('refuses the capture when an ending timed out unresolved', async () => {
    const { stop } = harness({
      shells: [{ shellId: 'a', threadId: root, status: EShellStatus.Running }],
      straggling: 1,
    })

    await expect(stop()).rejects.toThrow('background shells have not stopped')
  })

  it('ignores a running shell that belongs to an unrelated thread', async () => {
    const { stop, killed } = harness({
      shells: [{ shellId: 'c', threadId: stranger, status: EShellStatus.Running }],
    })

    await stop()

    expect(killed).toEqual([])
  })
  it('writes the queued endings to each family log before it answers', async () => {
    const ended = { type: 'shell-ended', shellId: 'a' } as unknown as EventDraft
    const { stop, appended } = harness({
      shells: [{ shellId: 'a', threadId: root, status: EShellStatus.Running }],
      endings: { root: [ended], stranger: [ended] },
    })

    await stop()

    expect(appended).toEqual([{ threadId: root, drafts: [ended] }])
  })

  it('leaves the endings queued when the capture is refused', async () => {
    const ended = { type: 'shell-ended', shellId: 'a' } as unknown as EventDraft
    const { stop, appended } = harness({
      shells: [{ shellId: 'a', threadId: root, status: EShellStatus.Running }],
      killedShellsEnd: false,
      endings: { root: [ended] },
    })

    await expect(stop()).rejects.toThrow()

    expect(appended).toEqual([])
  })
})

describe('ending the family shells before a move capture', () => {
  const build = (args: { shells: FakeShell[]; killedShellsEnd?: boolean }) => {
    const killed: string[] = []
    const end = endFamilyShellsFor({
      root,
      threads: { spawned: async ({ threadId }) => (threadId === root ? [{ id: child } as never] : []) },
      shells: {
        ...shellOperations({ ...args, killed }),
      },
    })
    return { end, killed }
  }

  it('kills the root’s and the descendants’ shells but not a stranger’s', async () => {
    const { end, killed } = build({
      shells: [
        { shellId: 'a', threadId: root, status: EShellStatus.Running },
        { shellId: 'b', threadId: child, status: EShellStatus.Running },
        { shellId: 'c', threadId: stranger, status: EShellStatus.Running },
      ],
    })

    await end()

    expect(killed.sort()).toEqual(['a', 'b'])
  })

  it('refuses when a family shell outlives the kill', async () => {
    const { end } = build({
      shells: [{ shellId: 'b', threadId: child, status: EShellStatus.Running }],
      killedShellsEnd: false,
    })

    await expect(end()).rejects.toThrow('background shells have not stopped')
  })
})
