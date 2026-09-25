import { describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  EAgentStatus,
  EShellStatus,
  toCallId,
  toRunId,
  toThreadId,
  type EventDraft,
} from '@dltech/atlas-core'
import { type RosterWire } from '@dltech/atlas-wire'
import {
  EClientRequest,
  LocalRewindMachinery,
  rewindThread,
  type RewindMachineryPort,
} from '@dltech/atlas-harness'

import { cloudApp } from '../cloud-app'
import { fakeBridge, CLOUD_THREAD, type FakeCloudChannel } from './fixture'
import { fakeApp, scriptedModelPort } from '../../__tests__/fake-app'

const runId = toRunId('run-cloud')
const said = (text: string): EventDraft => ({ type: 'user-said', text })

const startedInBackground: EventDraft = {
  type: 'tool-called',
  callId: toCallId('call-bg'),
  name: 'bash',
  input: { command: 'npm test', runInBackground: true },
  ordinal: 0,
}

const backgrounded: EventDraft = {
  type: 'tool-result',
  callId: toCallId('call-bg'),
  name: 'bash',
  output: { shellId: 'bash_1', status: 'running' },
}

const spawned: EventDraft = {
  type: 'agent-spawned',
  agentId: toThreadId('thr-child'),
  agentType: 'builder',
  intent: 'fix the failing test',
  mode: EAgentStart.Fresh,
}

const LIVE_ROSTER: RosterWire = {
  shells: [
    {
      shellId: 'bash_1' as RosterWire['shells'][number]['shellId'],
      threadId: CLOUD_THREAD,
      command: 'npm test',
      description: 'the suite',
      status: EShellStatus.Running,
      startedAt: '2026-09-24T10:00:00.000Z',
      lastOutputAt: '2026-09-24T10:00:01.000Z',
      totalCharacters: 64,
      awaitingInput: false,
    },
  ],
  agents: [
    {
      agentId: toThreadId('thr-child'),
      spawnedBy: CLOUD_THREAD,
      agentType: 'builder',
      intent: 'fix the failing test',
      status: EAgentStatus.Running,
      turns: 2,
      toolCalls: 5,
      lastTool: undefined,
      startedAt: '2026-09-24T10:00:00.000Z',
      endedAt: undefined,
    },
  ],
  services: [],
}

const settle = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const openCloudApp = async (args: { roster?: RosterWire | undefined }) => {
  const bridge = fakeBridge()
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
  bridge.attach({ threadId: CLOUD_THREAD, url: 'https://sandbox.example', token: 'tok' })
  const channel: FakeCloudChannel = bridge.channel
  const attached = cloudApp({ app, bridge, channel, runner: app.runner })

  if (args.roster !== undefined) channel.pushRoster(args.roster)
  await settle(100)

  await bridge.log.append({
    threadId: CLOUD_THREAD,
    runId,
    drafts: [said('msg_1'), startedInBackground, backgrounded, spawned, said('msg_2')],
  })

  return { bridge, channel, attached }
}

const machineryOf = (app: { rewindMachinery?: RewindMachineryPort | undefined }): RewindMachineryPort => {
  const machinery = app.rewindMachinery
  if (machinery === undefined) throw new Error('a cloud app must carry rewind machinery')
  return machinery
}

describe('rewind on a cloud thread', () => {
  it('warns with the sandbox’s live roster, not the host’s empty registries', async () => {
    const { bridge, attached } = await openCloudApp({ roster: LIVE_ROSTER })

    const result = await rewindThread({
      log: bridge.log,
      threads: bridge.threads,
      machinery: machineryOf(attached),
      threadId: CLOUD_THREAD,
      toSeq: 1,
    })

    expect(result).toMatchObject({
      ok: false,
      needsConfirmation: true,
      reachable: true,
      kills: [
        { kind: 'shell', shellId: 'bash_1', command: 'npm test', running: true },
        { kind: 'agent', agentId: toThreadId('thr-child'), agentType: 'builder', running: true },
      ],
    })
    expect(await bridge.log.read({ threadId: CLOUD_THREAD })).toHaveLength(5)
  })

  it('routes the confirmed cleanup to the sandbox over the channel, then truncates remotely', async () => {
    const { bridge, channel, attached } = await openCloudApp({ roster: LIVE_ROSTER })

    const result = await rewindThread({
      log: bridge.log,
      threads: bridge.threads,
      machinery: machineryOf(attached),
      threadId: CLOUD_THREAD,
      toSeq: 1,
      confirmed: true,
    })

    expect(result).toMatchObject({ ok: true })
    const rewindRequests = channel.requests.filter((request) => request.op === EClientRequest.Rewind)
    expect(rewindRequests).toHaveLength(1)
    expect(rewindRequests[0]?.params).toMatchObject({
      threadId: CLOUD_THREAD,
      cuts: [
        { kind: 'shell', shellId: 'bash_1' },
        { kind: 'agent', agentId: 'thr-child' },
      ],
    })
    expect(
      (await bridge.log.read({ threadId: CLOUD_THREAD })).map((event) => event.type),
    ).toEqual(['user-said'])
  })

  it('prices the cut with liveness unknown when the sandbox cannot answer', async () => {
    const { bridge, channel, attached } = await openCloudApp({})
    channel.close()

    const result = await rewindThread({
      log: bridge.log,
      threads: bridge.threads,
      machinery: machineryOf(attached),
      threadId: CLOUD_THREAD,
      toSeq: 1,
    })

    expect(result).toMatchObject({
      ok: false,
      needsConfirmation: true,
      reachable: true,
      kills: [
        { kind: 'shell', shellId: 'bash_1', running: false },
        { kind: 'agent', agentId: toThreadId('thr-child'), running: false },
      ],
    })
  })

  it('still lands the rewind write when the sandbox refuses the cleanup', async () => {
    const bridge = fakeBridge()
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
    bridge.attach({ threadId: CLOUD_THREAD, url: 'https://sandbox.example', token: 'tok' })
    const channel: FakeCloudChannel = bridge.channel
    const attached = cloudApp({ app, bridge, channel, runner: app.runner })
    await bridge.log.append({
      threadId: CLOUD_THREAD,
      runId,
      drafts: [said('msg_1'), startedInBackground, backgrounded, said('msg_2')],
    })
    channel.pushRoster(LIVE_ROSTER)
    await settle(100)

    const result = await rewindThread({
      log: bridge.log,
      threads: bridge.threads,
      machinery: machineryOf(attached),
      threadId: CLOUD_THREAD,
      toSeq: 1,
      confirmed: true,
    })

    expect(result).toMatchObject({ ok: true })
    expect(
      (await bridge.log.read({ threadId: CLOUD_THREAD })).map((event) => event.type),
    ).toEqual(['user-said'])
  })
})

describe('local machinery beside a cloud app', () => {
  it('prices nothing from the roster-free local registries, exactly as before', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
    const machinery = new LocalRewindMachinery({
      agents: app.agents,
      shells: app.shells,
      services: app.services,
    })

    const read = await machinery.snapshot({ cuts: [], threadId: toThreadId('thr-local') })

    expect(read).toEqual({ reachable: true, kills: [] })
  })
})
