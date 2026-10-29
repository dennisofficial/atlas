import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { act } from 'react'

import { EClientRequest } from '@dltech/atlas-client/channel'
import {
  EServiceStatus,
  EShellStatus,
  serviceSnapshotWireSchema,
  shellSnapshotWireSchema,
  type RosterWire,
  type ServiceSnapshotWire,
  type ShellSnapshotWire,
} from '@dltech/atlas-wire/web'

import type { RosterChannel } from '../roster-source'
import { EProcessKind, SHELL_READ_GAP_MS } from '../processes-model'
import { useProcesses, type ProcessesData } from '../use-processes'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const THREAD = 'thr_1'

const shell = (over: Partial<Record<string, unknown>> = {}): ShellSnapshotWire =>
  shellSnapshotWireSchema.parse({
    shellId: 'shell_1',
    threadId: THREAD,
    command: 'bun run dev',
    description: 'Dev server',
    status: EShellStatus.Running,
    startedAt: '2026-10-28T00:00:00.000Z',
    lastOutputAt: '2026-10-28T00:00:01.000Z',
    totalCharacters: 10,
    awaitingInput: false,
    ...over,
  })

const service = (over: Partial<Record<string, unknown>> = {}): ServiceSnapshotWire =>
  serviceSnapshotWireSchema.parse({
    serviceId: 'svc_1',
    command: 'postgres',
    description: 'Database',
    status: EServiceStatus.Running,
    logPath: '/tmp/svc_1.log',
    startedAt: '2026-10-28T00:00:00.000Z',
    ...over,
  })

const rosterOf = (args: {
  shells?: ShellSnapshotWire[]
  services?: ServiceSnapshotWire[]
}): RosterWire => ({ shells: args.shells ?? [], agents: [], services: args.services ?? [] })

type Call = { op: EClientRequest; params: unknown }

function fakeChannel(answer: (call: Call) => unknown) {
  const listeners: Array<(roster: RosterWire) => void> = []
  const calls: Call[] = []
  const channel: RosterChannel = {
    request: async (call) => {
      if (call.op === EClientRequest.ListRoster) return null
      calls.push(call)
      return answer(call)
    },
    onRoster: (listener) => {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    },
  }
  const push = async (roster: RosterWire) =>
    act(async () => {
      for (const listener of [...listeners]) listener(roster)
    })
  const callsOf = (op: EClientRequest) => calls.filter((call) => call.op === op)
  return { channel, push, callsOf }
}

const unmounts: Array<() => void> = []

afterEach(async () => {
  for (const unmount of unmounts.splice(0)) await act(async () => unmount())
})

async function mount(channel: RosterChannel) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  unmounts.push(() => root.unmount())
  let latest: ProcessesData | null = null
  function Probe() {
    latest = useProcesses({ threadId: THREAD, channel })
    return null
  }
  await act(async () => root.render(<Probe />))
  return () => {
    if (latest === null) throw new Error('the probe never rendered')
    return latest
  }
}

const settle = () => act(async () => Bun.sleep(0))

function gate() {
  const pending: Array<(reply: unknown) => void> = []
  const hold = () => new Promise((resolve) => pending.push(resolve))
  const release = async (reply: unknown) =>
    act(async () => {
      pending.shift()?.(reply)
      await Bun.sleep(0)
    })
  return { hold, release, waiting: () => pending.length }
}

describe('useProcesses', () => {
  it('lists the shells of this thread and every service off the roster push', async () => {
    const fake = fakeChannel(() => null)
    const data = await mount(fake.channel)
    await fake.push(
      rosterOf({
        shells: [shell(), shell({ shellId: 'shell_2', threadId: 'thr_child' })],
        services: [service()],
      }),
    )
    expect(data().shells.map((entry) => entry.shellId)).toEqual(['shell_1'])
    expect(data().services.map((entry) => entry.serviceId)).toEqual(['svc_1'])
  })

  it('handleKill sends kill-shell with threadId and shellId and keeps the row busy until a push shows it settled', async () => {
    const fake = fakeChannel(() => ({ ok: true, snapshot: shell({ status: EShellStatus.Killed }) }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleKill('shell_1'))
    await settle()
    expect(fake.callsOf(EClientRequest.KillShell)).toEqual([
      { op: EClientRequest.KillShell, params: { threadId: THREAD, shellId: 'shell_1' } },
    ])
    expect(data().busyId).toBe('shell_1')
    await fake.push(rosterOf({ shells: [shell({ totalCharacters: 90 })] }))
    expect(data().busyId).toBe('shell_1')
    await fake.push(rosterOf({ shells: [shell({ status: EShellStatus.Killed })] }))
    expect(data().busyId).toBeNull()
  })

  it('a refused kill surfaces the serve reason as the notice until the next action', async () => {
    const fake = fakeChannel(() => ({ ok: false, reason: 'no such shell' }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleKill('shell_1'))
    await settle()
    expect(data().notice).toBe('no such shell')
    expect(data().busyId).toBeNull()
    await fake.push(rosterOf({ shells: [shell({ totalCharacters: 90 })] }))
    expect(data().notice).toBe('no such shell')
    await act(async () => data().handleSelect({ kind: EProcessKind.Shell, id: 'shell_1' }))
    expect(data().notice).toBeNull()
  })

  it('turns a reply the build cannot read into the notice and frees the row', async () => {
    const fake = fakeChannel(() => ({ unexpected: true }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()], services: [service()] }))
    await act(async () => data().handleKill('shell_1'))
    expect(data().notice).not.toBeNull()
    expect(data().busyId).toBeNull()
    let started: boolean | undefined
    await act(async () => {
      started = await data().handleStart('ls')
    })
    expect(started).toBe(false)
  })

  it('handleStop sends stop-service with the service id', async () => {
    const fake = fakeChannel(() => ({ ok: true, snapshot: service() }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ services: [service()] }))
    await act(async () => data().handleStop('svc_1'))
    await settle()
    expect(fake.callsOf(EClientRequest.StopService)).toEqual([
      { op: EClientRequest.StopService, params: { serviceId: 'svc_1' } },
    ])
    expect(data().busyId).toBe('svc_1')
  })

  it('handleStart sends start-shell with the command as its description', async () => {
    const fake = fakeChannel(() => ({ ok: false, reason: 'refused' }))
    const data = await mount(fake.channel)
    let started: boolean | undefined
    await act(async () => {
      started = await data().handleStart('ls -la')
    })
    expect(started).toBe(false)
    expect(fake.callsOf(EClientRequest.StartShell)).toEqual([
      {
        op: EClientRequest.StartShell,
        params: { threadId: THREAD, command: 'ls -la', description: 'ls -la' },
      },
    ])
    expect(data().notice).toBe('refused')
  })

  it('reads the selected shell with characters 64000 and re-reads only when totalCharacters grows', async () => {
    const fake = fakeChannel(() => ({ ok: true, text: 'listening on :3000' }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleSelect({ kind: EProcessKind.Shell, id: 'shell_1' }))
    await settle()
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toEqual([
      {
        op: EClientRequest.ReadShellOutput,
        params: { threadId: THREAD, shellId: 'shell_1', characters: 64_000 },
      },
    ])
    expect(data().log).toBe('listening on :3000')
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => Bun.sleep(SHELL_READ_GAP_MS + 50))
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toHaveLength(1)
    await fake.push(rosterOf({ shells: [shell({ totalCharacters: 40 })] }))
    await act(async () => Bun.sleep(SHELL_READ_GAP_MS + 50))
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toHaveLength(2)
  })

  it('keeps one shell read in flight while the shell prints and keeps its text', async () => {
    const reads = gate()
    const fake = fakeChannel(reads.hold)
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleSelect({ kind: EProcessKind.Shell, id: 'shell_1' }))
    for (const total of [20, 30, 40, 50]) {
      await fake.push(rosterOf({ shells: [shell({ totalCharacters: total })] }))
    }
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toHaveLength(1)
    await reads.release({ ok: true, text: 'first' })
    expect(data().log).toBe('first')
    await act(async () => Bun.sleep(SHELL_READ_GAP_MS + 50))
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toHaveLength(2)
    await reads.release({ ok: true, text: 'second' })
    expect(data().log).toBe('second')
  })

  it('a refused shell read leaves no log text', async () => {
    const fake = fakeChannel(() => ({ ok: false, reason: 'gone' }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleSelect({ kind: EProcessKind.Shell, id: 'shell_1' }))
    await settle()
    expect(data().log).toBeNull()
  })

  it('reads the selected service log with characters 64000 and keeps an empty text empty', async () => {
    const fake = fakeChannel(() => ({ text: '' }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ services: [service()] }))
    await act(async () => data().handleSelect({ kind: EProcessKind.Service, id: 'svc_1' }))
    await settle()
    expect(fake.callsOf(EClientRequest.ReadServiceLog)).toEqual([
      { op: EClientRequest.ReadServiceLog, params: { serviceId: 'svc_1', characters: 64_000 } },
    ])
    expect(data().log).toBe('')
  })

  it('polls an expanded service every 5 s and stops when it collapses', async () => {
    const started = spyOn(globalThis, 'setInterval')
    const cleared = spyOn(globalThis, 'clearInterval')
    try {
      const fake = fakeChannel(() => ({ text: 'ready' }))
      const data = await mount(fake.channel)
      await fake.push(rosterOf({ services: [service()] }))
      await act(async () => data().handleSelect({ kind: EProcessKind.Service, id: 'svc_1' }))
      const polls = started.mock.calls.filter(([, ms]) => ms === 5_000)
      expect(polls).toHaveLength(1)
      const handle = started.mock.results[started.mock.calls.indexOf(polls[0] ?? [])]?.value
      await act(async () => data().handleSelect(null))
      expect(cleared.mock.calls.some(([id]) => id === handle)).toBe(true)
    } finally {
      started.mockRestore()
      cleared.mockRestore()
    }
  })
})
