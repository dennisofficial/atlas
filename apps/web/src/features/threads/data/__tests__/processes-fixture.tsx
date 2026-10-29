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
import { useProcesses, type ProcessesData } from '../use-processes'

export const THREAD = 'thr_1'

export const shell = (over: Partial<Record<string, unknown>> = {}): ShellSnapshotWire =>
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

export const service = (over: Partial<Record<string, unknown>> = {}): ServiceSnapshotWire =>
  serviceSnapshotWireSchema.parse({
    serviceId: 'svc_1',
    command: 'postgres',
    description: 'Database',
    status: EServiceStatus.Running,
    logPath: '/tmp/svc_1.log',
    startedAt: '2026-10-28T00:00:00.000Z',
    ...over,
  })

export const rosterOf = (args: {
  shells?: ShellSnapshotWire[]
  services?: ServiceSnapshotWire[]
}): RosterWire => ({ shells: args.shells ?? [], agents: [], services: args.services ?? [] })

type Call = { op: EClientRequest; params: unknown }

export function fakeChannel(answer: (call: Call) => unknown) {
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

export const unmountAll = async () => {
  for (const unmount of unmounts.splice(0)) await act(async () => unmount())
}

export async function mount(channel: RosterChannel) {
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

export const settle = () => act(async () => Bun.sleep(0))

export function gate() {
  const pending: Array<(reply: unknown) => void> = []
  const hold = () => new Promise((resolve) => pending.push(resolve))
  const release = async (reply: unknown) =>
    act(async () => {
      pending.shift()?.(reply)
      await Bun.sleep(0)
    })
  return { hold, release, waiting: () => pending.length }
}
