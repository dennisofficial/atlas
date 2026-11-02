import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { EAgentStatus, toThreadId } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest, EServeFrame, encodeFrame } from '@dltech/atlas-harness'
import {
  agentSnapshotWireSchema,
  ECapability,
  EModelWaitCause,
  EProviderFailureKind,
  ETurnStatus,
  EWaitEpisodeKind,
  readActivityReplySchema,
  rosterWireSchema,
  turnOutcomeWireSchema,
  waitingForModelWireSchema,
  type ReadActivityReply,
  type RosterWire,
} from '@dltech/atlas-wire'

import { createFrameBuffer } from '../frame-buffer'
import type { ServeAgentSteer } from '../serve-app'
import { createSessionHandlers, type SessionSocket } from '../socket-session'
import type { ServeTurnDriver } from '../turn-driver'
import { refusedFile } from './fakes'

const threadId = toThreadId('br_egress')

const waiting = waitingForModelWireSchema.parse({
  episode: {
    kind: EWaitEpisodeKind.Credential,
    key: { accountId: 'acc', providerId: 'anthropic', modelId: 'claude' },
    generation: 1,
  },
  cause: EModelWaitCause.Availability,
  providerId: 'anthropic',
  accountId: 'acc',
  modelId: 'claude',
  reason: EProviderFailureKind.Quota,
  resetAt: null,
  affectedThreadIds: [threadId],
})

const waitingChild = {
  agentId: toThreadId('child-waiting'),
  spawnedBy: threadId,
  agentType: 'explore',
  intent: 'map the seam',
  status: EAgentStatus.WaitingForModel,
  turns: 1,
  toolCalls: 2,
  lastTool: undefined,
  startedAt: '2026-11-01T00:00:00.000Z',
  endedAt: undefined,
}

const roster: RosterWire = rosterWireSchema.parse({
  shells: [],
  services: [],
  agents: [waitingChild],
})

const activity: ReadActivityReply = readActivityReplySchema.parse({
  runtimeId: 'runtime-1',
  revision: 1,
  turnEpoch: 1,
  working: true,
  awaiting: null,
  observedOutcome: null,
  waitingForModel: waiting,
})

const waitingOutcome = turnOutcomeWireSchema.parse({
  status: ETurnStatus.WaitingForModel,
  runId: 'run-1',
  waiting,
})

const LEGACY_STATUSES = Object.values(EAgentStatus).filter(
  (status) => status !== EAgentStatus.WaitingForModel,
)
const legacySnapshot = z.object({
  ...agentSnapshotWireSchema.shape,
  status: z.enum(LEGACY_STATUSES),
})
const legacyOutcome = z.object({
  status: z.enum([ETurnStatus.Failed]),
  runId: z.string(),
  message: z.string(),
})
const legacyActivity = readActivityReplySchema.omit({ waitingForModel: true })

const untouchedDriver = (): ServeTurnDriver =>
  ({
    running: () => false,
    busy: () => false,
    outcomePending: () => false,
    settled: async () => undefined,
  }) as unknown as ServeTurnDriver

const steered = { ok: true as const, snapshot: waitingChild }
const agents: ServeAgentSteer = {
  say: async () => steered,
  resume: async () => steered,
  stop: async () => steered,
  wake: async () => steered,
}

const transcript = {
  log: { head: async () => 0 },
  threads: { spawned: async () => [] },
} as unknown as NonNullable<Parameters<typeof createSessionHandlers>[0]['transcript']>

const buffer = createFrameBuffer({ capacity: 16 })

const handlers = createSessionHandlers({
  activity: { read: async () => activity },
  threadId,
  buffer,
  inFlight: () => [],
  liveStepId: () => null,
  driver: untouchedDriver(),
  files: { list: async () => [], read: async () => refusedFile },
  refusal: () => null,
  log: () => undefined,
  roster: { snapshot: () => roster, subscribe: () => () => undefined },
  agents,
  transcript,
})

type Peer = { socket: SessionSocket; frames: () => unknown[]; clear: () => void }

const flush = async (): Promise<void> => {
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve()
}

const attach = async (
  capabilities: readonly ECapability[] | undefined,
  channelCursor: number | null = null,
): Promise<Peer> => {
  const sent: string[] = []
  const socket = {
    data: { helloed: false, alias: null, greeting: 0, greeted: false, held: [], bootHeld: [] },
    send: (payload: string) => {
      sent.push(payload)
    },
    close: () => undefined,
    terminate: () => undefined,
  } as unknown as SessionSocket
  handlers.open({ socket })
  handlers.message({
    socket,
    message: encodeFrame({
      kind: EClientFrame.Hello,
      threadId,
      channelCursor,
      lastEventSeq: 0,
      ...(capabilities === undefined ? {} : { capabilities }),
    }),
  })
  await flush()
  return {
    socket,
    frames: () => sent.map((raw) => JSON.parse(raw) as unknown),
    clear: () => void sent.splice(0),
  }
}

const request = async (args: {
  peer: Peer
  op: EClientRequest
  params: unknown
}): Promise<{ ok: boolean; data: unknown }> => {
  args.peer.clear()
  handlers.message({
    socket: args.peer.socket,
    message: encodeFrame({
      kind: EClientFrame.Request,
      id: 'req',
      op: args.op,
      params: args.params,
    }),
  })
  await flush()
  const reply = args.peer.frames().find((frame) => (frame as { kind: string }).kind === 'reply')
  return reply as { ok: boolean; data: unknown }
}

const statusesOf = (data: unknown): unknown[] =>
  (data as RosterWire).agents.map((agent) => agent.status)

const agentParams = { threadId, agentId: waitingChild.agentId }

describe('serve egress for a peer without model-availability-controls', () => {
  it('downconverts the list-roster reply to a Paused agent an old schema parses', async () => {
    const peer = await attach(undefined)
    const reply = await request({ peer, op: EClientRequest.ListRoster, params: {} })
    expect(statusesOf(reply.data)).toEqual([EAgentStatus.Paused])
    const parsed = z.object({ agents: z.array(legacySnapshot) }).safeParse(reply.data)
    expect(parsed.success).toBe(true)
  })

  it('downconverts the roster broadcast', async () => {
    const peer = await attach([ECapability.ReadActivity])
    peer.clear()
    handlers.broadcastRoster()
    const frame = peer.frames()[0] as { kind: string; roster: unknown }
    expect(frame.kind).toBe(EServeFrame.Roster)
    expect(z.object({ agents: z.array(legacySnapshot) }).safeParse(frame.roster).success).toBe(true)
    expect(statusesOf(frame.roster)).toEqual([EAgentStatus.Paused])
  })

  it('downconverts say, resume and stop agent replies', async () => {
    const peer = await attach(undefined)
    for (const op of [EClientRequest.ResumeAgent, EClientRequest.StopAgent]) {
      const reply = await request({ peer, op, params: agentParams })
      const parsed = z
        .object({ ok: z.literal(true), snapshot: legacySnapshot })
        .safeParse(reply.data)
      expect(parsed.success).toBe(true)
      expect(parsed.data?.snapshot.status).toBe(EAgentStatus.Paused)
    }
    const said = await request({
      peer,
      op: EClientRequest.SayToAgent,
      params: { ...agentParams, text: 'go on' },
    })
    expect(
      z.object({ ok: z.literal(true), snapshot: legacySnapshot }).safeParse(said.data).success,
    ).toBe(true)
  })

  it('strips the waiting field from the read-activity reply', async () => {
    const peer = await attach(undefined)
    const reply = await request({
      peer,
      op: EClientRequest.ReadActivity,
      params: { threadId },
    })
    expect(legacyActivity.safeParse(reply.data).success).toBe(true)
    expect(reply.data).not.toHaveProperty('waitingForModel')
  })

  it('sends a broadcast waiting turn outcome as a Failed outcome with waiting text', async () => {
    const peer = await attach(undefined)
    peer.clear()
    handlers.broadcast(
      buffer.pushLifecycle({ kind: EServeFrame.TurnEnded, outcome: waitingOutcome }),
    )
    const frame = peer.frames()[0] as { kind: string; outcome: unknown }
    expect(frame.kind).toBe(EServeFrame.TurnEnded)
    const parsed = legacyOutcome.parse(frame.outcome)
    expect(parsed.status).toBe(ETurnStatus.Failed)
    expect(parsed.message).toContain('Waiting for model')
  })

  it('downconverts a waiting outcome replayed from the buffer to a reconnecting legacy peer', async () => {
    const anchor = buffer.push({ type: 'events-appended' })
    handlers.broadcast(
      buffer.pushLifecycle({ kind: EServeFrame.TurnEnded, outcome: waitingOutcome }),
    )
    const peer = await attach(undefined, anchor.seq)
    const replayed = peer
      .frames()
      .filter((frame) => (frame as { kind: string }).kind === EServeFrame.TurnEnded)
    expect(replayed.length).toBeGreaterThan(0)
    for (const frame of replayed) {
      expect(legacyOutcome.safeParse((frame as { outcome: unknown }).outcome).success).toBe(true)
    }
  })
})

describe('serve egress for a peer advertising model-availability-controls', () => {
  const capable = [ECapability.ModelAvailabilityControls]

  it('hands the untranslated enum to every path', async () => {
    const peer = await attach(capable)
    const listed = await request({ peer, op: EClientRequest.ListRoster, params: {} })
    expect(statusesOf(listed.data)).toEqual([EAgentStatus.WaitingForModel])

    const resumed = await request({ peer, op: EClientRequest.ResumeAgent, params: agentParams })
    expect((resumed.data as { snapshot: { status: string } }).snapshot.status).toBe(
      EAgentStatus.WaitingForModel,
    )

    const read = await request({ peer, op: EClientRequest.ReadActivity, params: { threadId } })
    expect(readActivityReplySchema.parse(read.data).waitingForModel).toEqual(waiting)

    peer.clear()
    handlers.broadcastRoster()
    expect(statusesOf((peer.frames()[0] as { roster: unknown }).roster)).toEqual([
      EAgentStatus.WaitingForModel,
    ])

    peer.clear()
    handlers.broadcast(
      buffer.pushLifecycle({ kind: EServeFrame.TurnEnded, outcome: waitingOutcome }),
    )
    const ended = peer.frames()[0] as { outcome: { status: string } }
    expect(ended.outcome.status).toBe(ETurnStatus.WaitingForModel)
  })

  it('translates per peer when capable and legacy peers are attached together', async () => {
    const modern = await attach(capable)
    const old = await attach(undefined)
    modern.clear()
    old.clear()
    handlers.broadcastRoster()
    expect(statusesOf((modern.frames()[0] as { roster: unknown }).roster)).toEqual([
      EAgentStatus.WaitingForModel,
    ])
    expect(statusesOf((old.frames()[0] as { roster: unknown }).roster)).toEqual([
      EAgentStatus.Paused,
    ])
  })
})
