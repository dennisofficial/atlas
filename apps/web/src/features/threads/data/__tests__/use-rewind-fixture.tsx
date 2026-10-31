import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { mock } from 'bun:test'
import { toast } from 'sonner'

import { EAgentStart, toCallId, toThreadId, type EventDraft } from '@dltech/atlas-core'
import {
  EPodState,
  EShellStatus,
  rosterWireSchema,
  type RosterWire,
  type WireEvent,
} from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import type { LivePrepareRewind } from '../live-thread-view'
import type { RewindSituation } from '../rewind-flow'
import { cloudThreadBackend } from '../thread-backend'
import { ThreadBackendProvider } from '../use-thread-backend'
import { useRewind } from '../use-rewind'

export const wireEvents = (drafts: readonly EventDraft[]): WireEvent[] =>
  drafts.map((draft, seq) => ({
    id: `evt_${seq}`,
    seq,
    threadId: 'thr_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-10-31T00:00:00.000Z',
    type: draft.type,
    body: JSON.stringify(draft),
  }))

export const plain = wireEvents([
  { type: 'user-said', text: 'one' },
  { type: 'assistant-said', parts: [{ type: 'text', text: 'two' }] },
  { type: 'user-said', text: 'three' },
])
export const destructive = [
  ...plain,
  ...wireEvents([
    {
      type: 'agent-spawned',
      agentId: toThreadId('thr_child'),
      agentType: 'explore',
      intent: 'audit',
      mode: EAgentStart.Fresh,
    },
    { type: 'background-shell-started', shellId: 'bash_1', command: 'bun test' },
    {
      type: 'tool-called',
      callId: toCallId('call_1'),
      name: 'service_start',
      input: { command: 'bun dev' },
      ordinal: 0,
    },
    {
      type: 'tool-result',
      callId: toCallId('call_1'),
      name: 'service_start',
      output: { serviceId: 'svc_1', status: 'running' },
    },
  ]).map((event) => ({ ...event, id: `evt_${event.seq + 3}`, seq: event.seq + 3 })),
]
export const runningRoster = rosterWireSchema.parse({
  agents: [],
  services: [],
  shells: [
    {
      shellId: 'bash_1',
      threadId: 'thr_1',
      command: 'bun test',
      description: 'Tests',
      status: EShellStatus.Running,
      startedAt: '',
      lastOutputAt: '',
      totalCharacters: 0,
      awaitingInput: false,
    },
  ],
})
export const fullCuts = [
  { kind: 'agent', agentId: 'thr_child', agentType: 'explore', intent: 'audit' },
  { kind: 'shell', shellId: 'bash_1', command: 'bun test' },
  { kind: 'service', serviceId: 'svc_1', command: 'bun dev' },
]
export const emptyRoster: RosterWire = { agents: [], shells: [], services: [] }
export const point = { eventId: 'evt_2', text: 'three' }

export function rewindRig(
  args: {
    prepareRewind?: LivePrepareRewind | undefined
    local?: boolean
    situation?: Partial<RewindSituation>
  } = {},
) {
  const applyRewind = mock(
    async (_request: { cuts: readonly unknown[]; toSeq: number }) => undefined,
  )
  const rewind = mock(async () => undefined)
  const readRoster = mock(async () => emptyRoster)
  const refreshEvents = mock(() => undefined)
  const onRestore = mock((_text: string) => undefined)
  const source = { applyRewind, readRoster, refreshEvents, prepareRewind: args.prepareRewind }
  let situation: RewindSituation = {
    threadId: 'thr_1',
    events: eventsFromWire(plain),
    live: false,
    working: false,
    podState: EPodState.Parked,
    ...args.situation,
  }
  let latest: ReturnType<typeof useRewind> | undefined
  function Probe() {
    const rendered = situation
    latest = useRewind({ situation: () => rendered, source, onRestore })
    return null
  }
  const warning = mock((_message: string) => 0)
  const root = createRoot(document.createElement('div'))
  let warningDescriptor: PropertyDescriptor | undefined
  const restoreWarning = () => {
    if (warningDescriptor === undefined) Reflect.deleteProperty(toast, 'warning')
    else Object.defineProperty(toast, 'warning', warningDescriptor)
  }
  const render = () =>
    root.render(
      <ThreadBackendProvider backend={{ ...cloudThreadBackend, local: args.local ?? true, rewind }}>
        <Probe />
      </ThreadBackendProvider>,
    )
  const data = () => {
    if (latest === undefined) throw new Error('rewind probe has not mounted')
    return latest
  }
  return {
    applyRewind,
    rewind,
    readRoster,
    refreshEvents,
    onRestore,
    data,
    warning,
    mount: async () => {
      warningDescriptor = Object.getOwnPropertyDescriptor(toast, 'warning')
      Object.defineProperty(toast, 'warning', {
        value: warning,
        configurable: true,
        writable: true,
      })
      try {
        await act(async () => render())
      } catch (failure) {
        restoreWarning()
        throw failure
      }
    },
    unmount: async () => {
      try {
        await act(async () => root.unmount())
      } finally {
        restoreWarning()
      }
    },
    update: (change: Partial<RewindSituation>) =>
      act(async () => {
        situation = { ...situation, ...change }
        render()
      }),
  }
}
