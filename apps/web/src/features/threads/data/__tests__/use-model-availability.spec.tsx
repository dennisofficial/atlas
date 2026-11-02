import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'

import { EClientRequest, ECloudControlOutcome } from '@dltech/atlas-client/channel'
import { EConnectionView } from '@dltech/atlas-client/channel'
import { EModelWaitAction, NO_SESSIONS_WAITING } from '@dltech/atlas-client/transcript'
import {
  EModelWaitCause,
  EProviderFailureKind,
  EWaitEpisodeKind,
  stampDrafts,
  toAccountId,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
  type WaitingForModel,
} from '@dltech/atlas-core'
import {
  capabilitySetOf,
  ECapability,
  ECredentialAvailability,
  ECredentialFence,
} from '@dltech/atlas-wire/web'

const push = mock((_href: string) => undefined)
mock.module('next/navigation', () => ({ useRouter: () => ({ push }) }))

const { useModelAvailability } = await import('../use-model-availability')

import type { ServeChannel } from '../live-thread-view'
import type { AccountDirectory } from '../use-account-directory'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
const unmounts: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) await unmount()
  push.mockClear()
})

const key = { accountId: toAccountId('acct-1'), providerId: 'anthropic', modelId: 'claude-x' }
const children = Array.from({ length: 30 }, (_value, index) => toThreadId(`child-${index}`))
const waiting = (overrides: Partial<WaitingForModel> = {}): WaitingForModel => ({
  episode: { kind: EWaitEpisodeKind.Credential, key, generation: 4 },
  cause: EModelWaitCause.Availability,
  providerId: 'anthropic',
  accountId: 'acct-1',
  modelId: 'claude-x',
  reason: EProviderFailureKind.Quota,
  resetAt: null,
  affectedThreadIds: children,
  ...overrides,
})

const log = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_draft, index) => ({
      id: toEventId(`event-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId('root'),
      runId: toRunId('run'),
      depth: 0,
      at: '2026-11-02T10:00:00.000Z',
    })),
  })

const waitingLog = (wait = waiting()) =>
  log([
    { type: 'user-said', text: 'go' },
    { type: 'model-waiting', waiting: wait },
  ])

type Call = { op: EClientRequest; params: unknown }

const channelOf = (args: {
  reply?: (call: Call) => unknown
  capable?: boolean
  state?: EConnectionView
  read?: WaitingForModel
}) => {
  const calls: Call[] = []
  const capable = args.capable ?? true
  const channel = {
    request: async (call: Call) => {
      calls.push(call)
      const custom = args.reply?.(call)
      if (custom !== undefined) return custom
      if (call.op === EClientRequest.ReadModelAvailability)
        return { waiting: [args.read ?? waiting()] }
      return {
        result: 'available',
        snapshot: {
          key,
          availability: ECredentialAvailability.Available,
          revision: { fence: ECredentialFence.Replaced, value: 4 },
          since: '2026-11-02T10:00:00.000Z',
        },
      }
    },
    connection: () => ({ state: args.state ?? EConnectionView.Connected, detail: null }),
    capabilities: () => capabilitySetOf(capable ? [ECapability.ModelAvailabilityControls] : []),
  } as unknown as ServeChannel
  return { channel, calls }
}

const accounts = (isCloud: boolean): AccountDirectory => ({
  labelOf: () => 'Work account',
  isCloud: () => isCloud,
})

type Hook = ReturnType<typeof useModelAvailability>

async function mount(args: {
  channel: ServeChannel | null
  events?: Event[]
  isCloud?: boolean
  cloud?: Parameters<typeof useModelAvailability>[0]['cloud']
  openAgent?: (id: string) => void
}) {
  const { createRoot } = await import('react-dom/client')
  const box: { api: Hook | null } = { api: null }
  const roster = {
    shells: [],
    services: [],
    agents: [
      {
        agentId: 'child-0',
        agentType: 'explore',
        intent: 'Look around',
        spawnedBy: 'root',
        status: 'running',
        startedAt: '2026-11-02T10:00:00.000Z',
        turns: 1,
        toolCalls: 1,
      },
    ],
  } as unknown as Parameters<typeof useModelAvailability>[0]['roster']
  const events = args.events ?? waitingLog()
  const directory = accounts(args.isCloud ?? false)
  function Probe() {
    box.api = useModelAvailability({
      threadId: 'root',
      events,
      channel: args.channel,
      snapshot: null,
      accounts: directory,
      roster,
      openAgent: args.openAgent ?? (() => undefined),
      ...(args.cloud === undefined ? {} : { cloud: args.cloud }),
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe />))
  await act(async () => undefined)
  unmounts.push(() => act(async () => root.unmount()))
  return box
}

const select = async (box: { api: Hook | null }, id: EModelWaitAction) => {
  const action = box.api?.card?.issues[0]?.actions.find((entry) => entry.id === id)
  await act(async () => action?.onSelect())
  await act(async () => undefined)
}

describe('useModelAvailability', () => {
  it('collapses 30 blocked children into one issue card and Recheck sends one channel op', async () => {
    const { channel, calls } = channelOf({})
    const box = await mount({ channel })
    expect(box.api?.card?.issues).toHaveLength(1)
    expect(box.api?.card?.issues[0]?.affected).toHaveLength(30)
    const reads = calls.length
    await select(box, EModelWaitAction.Recheck)
    const controls = calls.filter(
      (call) => call.op === EClientRequest.ControlLocalModelAvailability,
    )
    expect(controls).toHaveLength(1)
    expect(controls[0]?.params).toMatchObject({ action: 'recheck', expectedGeneration: 4 })
    expect(calls.length - reads).toBeLessThanOrEqual(2)
  })

  it('removes a cloud pause through the API adapter, then rechecks over the channel', async () => {
    const cloud = mock(async () => ECloudControlOutcome.Applied)
    const paused = waiting({ reason: null })
    const { channel, calls } = channelOf({ read: paused })
    const events = waitingLog(paused)
    const box = await mount({ channel, events, isCloud: true, cloud })
    await select(box, EModelWaitAction.RemoveManualPause)
    expect(cloud).toHaveBeenCalledTimes(1)
    expect(cloud.mock.calls[0]).toEqual([{ key, expectedGeneration: 4, action: 'resume' }])
    const controls = calls.filter(
      (call) => call.op === EClientRequest.ControlLocalModelAvailability,
    )
    expect(controls.map((call) => (call.params as { action: string }).action)).toEqual(['recheck'])
  })

  it('reloads and asks for a retry when the API says the account changed', async () => {
    const cloud = mock(async () => ECloudControlOutcome.Stale)
    const paused = waiting({ reason: null })
    const { channel, calls } = channelOf({ read: paused })
    const events = waitingLog(paused)
    const box = await mount({ channel, events, isCloud: true, cloud })
    const readsBefore = calls.filter((call) => call.op === EClientRequest.ReadModelAvailability)
    await select(box, EModelWaitAction.RemoveManualPause)
    expect(box.api?.card?.issues[0]?.note?.text).toContain('Try again')
    const readsAfter = calls.filter((call) => call.op === EClientRequest.ReadModelAvailability)
    expect(readsAfter.length).toBeGreaterThan(readsBefore.length)
  })

  it('keeps the card and shows an action error when the transport fails', async () => {
    const { channel } = channelOf({
      reply: (call) => {
        if (call.op === EClientRequest.ControlLocalModelAvailability)
          throw new Error('socket closed')
        return undefined
      },
    })
    const box = await mount({ channel })
    await select(box, EModelWaitAction.Recheck)
    expect(box.api?.card?.issues).toHaveLength(1)
    expect(box.api?.card?.issues[0]?.note?.text).toBe('socket closed')
  })

  it('does not read a failed models-list read as an empty list', async () => {
    const { channel } = channelOf({
      reply: (call) => {
        if (call.op === EClientRequest.ReadModelAvailability) throw new Error('read failed')
        return undefined
      },
    })
    const box = await mount({ channel })
    expect(box.api?.waitingLive).toBeNull()
    expect(box.api?.card?.issues).toHaveLength(1)
  })

  it('says no sessions are waiting when the authoritative list has no affected threads', async () => {
    const { channel } = channelOf({
      reply: (call) =>
        call.op === EClientRequest.ReadModelAvailability
          ? { waiting: [waiting({ affectedThreadIds: [] })] }
          : undefined,
    })
    const box = await mount({ channel })
    expect(box.api?.card?.issues[0]?.affectedLabel).toBe(NO_SESSIONS_WAITING)
  })

  it('disables the controls with the update hint for a serve without the capability', async () => {
    const { channel, calls } = channelOf({ capable: false })
    const box = await mount({ channel })
    const recheck = box.api?.card?.issues[0]?.actions.find((a) => a.id === EModelWaitAction.Recheck)
    expect(recheck?.disabled).toBe(true)
    expect(recheck?.disabledReason).toContain('Update/restart')
    expect(calls).toEqual([])
  })

  it('opens an agent thread from the card and routes Providers to settings', async () => {
    const openAgent = mock((_id: string) => undefined)
    const { channel } = channelOf({})
    const box = await mount({ channel, openAgent })
    const [first, other] = box.api?.card?.issues[0]?.affected ?? []
    act(() => first?.onOpen?.())
    expect(openAgent).toHaveBeenCalledWith('child-0')
    expect(other?.onOpen).toBeUndefined()
    await select(box, EModelWaitAction.Providers)
    expect(push).toHaveBeenCalledTimes(1)
  })
})
