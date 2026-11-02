import { z } from 'zod'

import { EAgentStatus, toThreadId } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest, encodeFrame } from '@dltech/atlas-harness'
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

export const threadId = toThreadId('br_egress')

export const waiting = waitingForModelWireSchema.parse({
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

export const waitingChild = {
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

export const roster: RosterWire = rosterWireSchema.parse({
  shells: [],
  services: [],
  agents: [waitingChild],
})

export const activity: ReadActivityReply = readActivityReplySchema.parse({
  runtimeId: 'runtime-1',
  revision: 1,
  turnEpoch: 1,
  working: true,
  awaiting: null,
  observedOutcome: null,
  waitingForModel: waiting,
})

export const waitingOutcome = turnOutcomeWireSchema.parse({
  status: ETurnStatus.WaitingForModel,
  runId: 'run-1',
  waiting,
})

const LEGACY_STATUSES = Object.values(EAgentStatus).filter(
  (status) => status !== EAgentStatus.WaitingForModel,
)
export const legacySnapshot = z.object({
  ...agentSnapshotWireSchema.shape,
  status: z.enum(LEGACY_STATUSES),
})
export const legacyOutcome = z.object({
  status: z.enum([ETurnStatus.Failed]),
  runId: z.string(),
  message: z.string(),
})
export const legacyActivity = readActivityReplySchema.omit({ waitingForModel: true })

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

export const buffer = createFrameBuffer({ capacity: 16 })

export const handlers = createSessionHandlers({
  activity: { read: async () => activity },
  threadId,
  buffer,
  inFlight: () => [],
  liveStepId: () => null,
  driver: untouchedDriver(),
  files: { list: async () => [] },
  refusal: () => null,
  log: () => undefined,
  roster: { snapshot: () => roster, subscribe: () => () => undefined },
  agents,
  transcript,
})

export type Peer = { socket: SessionSocket; frames: () => unknown[]; clear: () => void }

const flush = async (): Promise<void> => {
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve()
}

export const attach = async (
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

export const request = async (args: {
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

export const statusesOf = (data: unknown): unknown[] =>
  (data as RosterWire).agents.map((agent) => agent.status)

export const agentParams = { threadId, agentId: waitingChild.agentId }
