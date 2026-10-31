import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import { createRemoteDeltaChannel } from '@dltech/atlas-client/channel'
import {
  EAgentStatus,
  eventBodySchema,
  stampEvent,
  toEventId,
  toRunId,
  toThreadId,
} from '@dltech/atlas-core'
import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import type { RosterWire } from '@dltech/atlas-wire/web'

import { cloudThreadBackend } from '../thread-backend'
import { useAgents, type AgentsData } from '../use-agents'
import { ThreadBackendProvider } from '../use-thread-backend'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) await act(async () => unmount())
})

const threadId = 'thr_1'
const identity = { agentId: 'agent_1', agentType: 'explore', intent: 'Investigate the failure' }
const at = '2026-10-31T10:00:00.000Z'
const event = (args: { seq: number; body: Record<string, unknown> }) =>
  stampEvent({
    draft: eventBodySchema.parse(args.body),
    envelope: {
      id: toEventId(`evt_${args.seq}`),
      seq: args.seq,
      threadId: toThreadId(threadId),
      runId: toRunId('run_1'),
      depth: 0,
      at,
    },
  })
const spawned = event({ seq: 1, body: { type: 'agent-spawned', ...identity, mode: 'fresh' } })
const ended = event({
  seq: 2,
  body: {
    type: 'agent-ended',
    ...identity,
    status: EAgentStatus.Finished,
    prose: 'Found the cause',
    turns: 2,
    toolCalls: 3,
  },
})
const rosterOf = (status: EAgentStatus): RosterWire => ({
  shells: [],
  services: [],
  agents: [{ ...identity, spawnedBy: threadId, status, startedAt: at, turns: 1, toolCalls: 1 }],
})

type Input = Parameters<typeof useAgents>[0]

async function mount(overrides: Partial<Input> = {}) {
  const fetchEvents = mock(async () => [])
  const fetchSeed = mock(async () => [])
  const fetchSpawned = mock(async () => [])
  const backend = { ...cloudThreadBackend, fetchEvents, fetchSeed, fetchSpawned }
  const listeners = new Set<(roster: RosterWire) => void>()
  const deferred = createRemoteDeltaChannel({ threadId: toThreadId(threadId) })
  const channel = {
    ...deferred,
    request: async () => null,
    onRoster: (listener: (roster: RosterWire) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  let input: Input = {
    threadId,
    channel,
    working: false,
    events: [spawned],
    loaded: true,
    error: null,
    ...overrides,
  }
  let latest: AgentsData | null = null
  function Probe() {
    latest = useAgents(input)
    return <span>{latest.agents.map((agent) => agent.display).join(',')}</span>
  }
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  unmounts.push(() => {
    root.unmount()
    deferred.close()
  })
  const render = async (next: Partial<Input> = {}) => {
    input = { ...input, ...next }
    await act(async () =>
      root.render(
        <ThreadBackendProvider backend={backend}>
          <Probe />
        </ThreadBackendProvider>,
      ),
    )
  }
  await render()
  return {
    fetchEvents,
    fetchSeed,
    fetchSpawned,
    render,
    text: () => container.textContent,
    data: () => {
      if (latest === null) throw new Error('The probe never rendered')
      return latest
    },
    push: (roster: RosterWire) =>
      act(async () => {
        for (const listener of listeners) listener(roster)
      }),
  }
}

describe('useAgents with shared source events', () => {
  it('never rereads history on mount or working and roster transitions', async () => {
    const test = await mount()
    expect(test.fetchSpawned).toHaveBeenCalledTimes(1)
    expect(test.fetchEvents).not.toHaveBeenCalled()
    expect(test.fetchSeed).not.toHaveBeenCalled()
    await test.render({ working: true })
    expect(test.fetchSpawned).toHaveBeenCalledTimes(2)
    await test.push(rosterOf(EAgentStatus.Running))
    expect(test.fetchSpawned).toHaveBeenCalledTimes(3)
    expect(test.text()).toBe(EAgentDisplay.Running)
    await test.push(rosterOf(EAgentStatus.Paused))
    expect(test.fetchSpawned).toHaveBeenCalledTimes(4)
    expect(test.text()).toBe(EAgentDisplay.Paused)
    await test.render({ working: false })
    expect(test.fetchSpawned).toHaveBeenCalledTimes(5)
    expect(test.fetchEvents).not.toHaveBeenCalled()
    expect(test.fetchSeed).not.toHaveBeenCalled()
  })

  it('updates displayed agent state from new parsed events without another read', async () => {
    const test = await mount({ channel: null })
    expect(test.text()).toBe(EAgentDisplay.Paused)
    await test.render({ events: [spawned, ended] })
    expect(test.text()).toBe(EAgentDisplay.Done)
    expect(test.data().agents[0]?.report).toBe('Found the cause')
    await test.render({ events: [] })
    expect(test.data().agents).toEqual([])
    expect(test.fetchSpawned).toHaveBeenCalledTimes(1)
    expect(test.fetchEvents).not.toHaveBeenCalled()
    expect(test.fetchSeed).not.toHaveBeenCalled()
  })

  it('preserves source loading and errors independently of whether events are empty', async () => {
    const test = await mount({ events: [], loaded: false })
    expect(test.data()).toMatchObject({ loaded: false, error: null })
    const error = new Error('Source history unavailable')
    await test.render({ error })
    expect(test.data()).toMatchObject({ loaded: false, error })
    await test.render({ events: [spawned] })
    expect(test.data()).toMatchObject({ loaded: false, error })
    await test.render({ events: [], loaded: true, error: null })
    expect(test.data()).toMatchObject({ agents: [], loaded: true, error: null })
    await test.render({ error })
    expect(test.data()).toMatchObject({ loaded: true, error: null })
    expect(test.fetchEvents).not.toHaveBeenCalled()
    expect(test.fetchSeed).not.toHaveBeenCalled()
  })
})
