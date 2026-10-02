import { describe, expect, it } from 'bun:test'

import {
  EServiceStatus,
  EShellStatus,
  toRunId,
  toThreadId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { stopWorkspaceProcessesFor } from '../workspace-hooks'

const root = toThreadId('root')
const child = toThreadId('child')
const stranger = toThreadId('stranger')

type FakeShell = { shellId: string; threadId: ThreadId; status: EShellStatus }

const harness = (args: {
  shells: FakeShell[]
  services?: { serviceId: string; status: EServiceStatus }[]
  killedShellsEnd?: boolean
  straggling?: number
  endings?: Record<string, EventDraft[]>
}) => {
  const killed: string[] = []
  const stopped: string[] = []
  const appended: { threadId: ThreadId; drafts: readonly EventDraft[] }[] = []
  const queued = new Map<ThreadId, EventDraft[]>(Object.entries(args.endings ?? {}) as never)
  const services = args.services ?? []
  const stop = stopWorkspaceProcessesFor({
    root,
    threads: {
      spawned: async ({ threadId }) =>
        threadId === root ? [{ id: child } as never] : [],
    },
    shells: {
      listEverywhere: () => args.shells as never,
      kill: ({ shellId }) => {
        killed.push(shellId)
        const shell = args.shells.find((candidate) => candidate.shellId === shellId)
        if (shell !== undefined && args.killedShellsEnd !== false) shell.status = EShellStatus.Killed
        return { ok: true } as never
      },
      awaitEndings: async () => args.straggling ?? 0,
      drainNotifications: ({ threadId }) => {
        const drafts = queued.get(threadId) ?? []
        queued.delete(threadId)
        return drafts
      },
    },
    services: {
      list: () => services as never,
      stop: ({ serviceId }) => {
        stopped.push(serviceId)
        const service = services.find((candidate) => candidate.serviceId === serviceId)
        if (service !== undefined) service.status = EServiceStatus.Killed
        return { ok: true } as never
      },
      awaitEndings: async () => 0,
      drainNotifications: () => [],
    },
    log: {
      append: async (given) => {
        appended.push({ threadId: given.threadId, drafts: given.drafts })
        return []
      },
    },
    ids: { nextRunId: () => toRunId('run-stop') },
  })
  return { stop, killed, stopped, appended }
}

describe('stopping the workspace processes before a capture', () => {
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

    await expect(stop()).rejects.toThrow('still writing to the workspace')
  })

  it('refuses the capture when an ending timed out unresolved', async () => {
    const { stop } = harness({
      shells: [{ shellId: 'a', threadId: root, status: EShellStatus.Running }],
      straggling: 1,
    })

    await expect(stop()).rejects.toThrow('still writing to the workspace')
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
