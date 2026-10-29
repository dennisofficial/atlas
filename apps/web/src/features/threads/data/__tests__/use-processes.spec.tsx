import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
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
import { EProcessKind } from '../processes-model'
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

async function mount(channel: RosterChannel) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
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

describe('useProcesses', () => {
  it('lists shells and services off the roster push', async () => {
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

  it('handleKill sends kill-shell with threadId and shellId and disables the row until the next roster push', async () => {
    const fake = fakeChannel(() => ({ ok: true, snapshot: shell({ status: EShellStatus.Killed }) }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleKill('shell_1'))
    await settle()
    expect(fake.callsOf(EClientRequest.KillShell)).toEqual([
      { op: EClientRequest.KillShell, params: { threadId: THREAD, shellId: 'shell_1' } },
    ])
    expect(data().busyId).toBe('shell_1')
    await fake.push(rosterOf({ shells: [shell({ status: EShellStatus.Killed })] }))
    expect(data().busyId).toBeNull()
  })

  it('a refused kill surfaces the serve reason as the notice', async () => {
    const fake = fakeChannel(() => ({ ok: false, reason: 'no such shell' }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleKill('shell_1'))
    await settle()
    expect(data().notice).toBe('no such shell')
    expect(data().busyId).toBeNull()
    await fake.push(rosterOf({ shells: [shell()] }))
    expect(data().notice).toBeNull()
  })

  it('keeps a refusal that lands after a roster push visible', async () => {
    let release: (reply: unknown) => void = () => undefined
    const fake = fakeChannel(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    let pending: Promise<void> = Promise.resolve()
    await act(async () => {
      pending = data().handleKill('shell_1')
    })
    await fake.push(rosterOf({ shells: [shell({ totalCharacters: 20 })] }))
    await act(async () => {
      release({ ok: false, reason: 'already gone' })
      await pending
    })
    expect(data().notice).toBe('already gone')
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
    await settle()
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toHaveLength(1)
    await fake.push(rosterOf({ shells: [shell({ totalCharacters: 40 })] }))
    await settle()
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toHaveLength(2)
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
})
