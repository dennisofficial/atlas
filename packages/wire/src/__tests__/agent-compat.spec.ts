import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import {
  agentOutcomeWireSchema,
  agentSnapshotWireSchema,
  capabilitySetOf,
  CHANNEL_PROTOCOL_MIN_VERSION,
  CHANNEL_PROTOCOL_VERSION,
  downgradeAgentOutcome,
  downgradeAgentSnapshot,
  downgradeReadActivity,
  downgradeRoster,
  downgradeServeFrame,
  downgradeTurnOutcome,
  EAgentStatus,
  ECapability,
  EModelWaitCause,
  EProviderFailureKind,
  EServeFrame,
  ETurnStatus,
  EWaitEpisodeKind,
  readActivityReplySchema,
  rosterWireSchema,
  runFailureWireSchema,
  SERVE_CAPABILITIES,
  serveFrameSchema,
  turnOutcomeWireSchema,
  waitingForModelWireSchema,
  waitingTextOf,
  type ServeFrame,
} from '../index'

const LEGACY_STATUSES = Object.values(EAgentStatus).filter(
  (status) => status !== EAgentStatus.WaitingForModel,
)

const legacySnapshotSchema = z.object({
  ...agentSnapshotWireSchema.shape,
  status: z.enum(LEGACY_STATUSES),
})
const legacyRosterSchema = z.object({
  ...rosterWireSchema.shape,
  agents: z.array(legacySnapshotSchema),
})
const legacyAgentOutcomeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), snapshot: legacySnapshotSchema }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])
const legacyTurnOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal(ETurnStatus.Completed), runId: z.string() }),
  z.object({
    status: z.literal(ETurnStatus.Paused),
    runId: z.string(),
    callId: z.string(),
    reason: z.string(),
  }),
  z.object({ status: z.literal(ETurnStatus.Idle), runId: z.string() }),
  z.object({
    status: z.literal(ETurnStatus.Interrupted),
    runId: z.string(),
    committed: z.boolean(),
  }),
  z.object({
    status: z.literal(ETurnStatus.RelocationPaused),
    runId: z.string(),
  }),
  z.object({
    status: z.literal(ETurnStatus.Failed),
    runId: z.string(),
    message: z.string(),
    failure: runFailureWireSchema.optional(),
  }),
])
const legacyActivitySchema = readActivityReplySchema.omit({
  waitingForModel: true,
})

const legacy = capabilitySetOf(undefined)
const olderCapable = capabilitySetOf([ECapability.ReadActivity, ECapability.CommandList])
const capable = capabilitySetOf(SERVE_CAPABILITIES)

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
  resetAt: '2026-11-02T00:00:00.000Z',
  affectedThreadIds: ['root'],
})

const snapshotOf = (status: EAgentStatus) =>
  agentSnapshotWireSchema.parse({
    agentId: 'child',
    spawnedBy: 'root',
    agentType: 'explore',
    intent: 'map',
    status,
    turns: 1,
    toolCalls: 2,
    startedAt: '2026-11-01T00:00:00.000Z',
  })

const waitingOutcome = turnOutcomeWireSchema.parse({
  status: ETurnStatus.WaitingForModel,
  runId: 'run-1',
  waiting,
})

describe('the legacy schemas this suite stands in for', () => {
  it('reject the new enum, so a pass below proves the translation', () => {
    expect(legacySnapshotSchema.safeParse(snapshotOf(EAgentStatus.WaitingForModel)).success).toBe(
      false,
    )
    expect(legacyTurnOutcomeSchema.safeParse(waitingOutcome).success).toBe(false)
    expect(
      legacyActivitySchema.safeParse({
        runtimeId: 'r',
        revision: 0,
        turnEpoch: 0,
        working: false,
        awaiting: null,
        observedOutcome: null,
        waitingForModel: waiting,
      }).success,
    ).toBe(false)
  })
})

describe('legacy-schema egress round-trips', () => {
  it('an old agentSnapshotWireSchema parses a waiting agent after downconversion to Paused', () => {
    const down = downgradeAgentSnapshot({
      snapshot: snapshotOf(EAgentStatus.WaitingForModel),
      capabilities: legacy,
    })
    const parsed = legacySnapshotSchema.parse(JSON.parse(JSON.stringify(down)))
    expect(parsed.status).toBe(EAgentStatus.Paused)
    expect(parsed.status).not.toBe(EAgentStatus.Running)
    expect(parsed.failureCause).toBe('waiting for model access')
    expect(parsed.endedAt).toBeUndefined()
  })

  it('an old rosterWireSchema parses a roster mixing waiting and ordinary agents', () => {
    const roster = rosterWireSchema.parse({
      shells: [],
      services: [],
      agents: Object.values(EAgentStatus).map((status) => snapshotOf(status)),
    })
    for (const caps of [legacy, olderCapable]) {
      const down = downgradeRoster({ roster, capabilities: caps })
      const parsed = legacyRosterSchema.parse(JSON.parse(JSON.stringify(down)))
      expect(parsed.agents.map((agent) => agent.status)).toEqual(
        roster.agents.map((agent) =>
          agent.status === EAgentStatus.WaitingForModel ? EAgentStatus.Paused : agent.status,
        ),
      )
    }
  })

  it('an old agent-reply schema parses start/resume/stop outcomes after downconversion', () => {
    const outcome = agentOutcomeWireSchema.parse({
      ok: true,
      snapshot: snapshotOf(EAgentStatus.WaitingForModel),
    })
    const down = downgradeAgentOutcome({ outcome, capabilities: legacy })
    const parsed = legacyAgentOutcomeSchema.parse(JSON.parse(JSON.stringify(down)))
    expect(parsed.ok && parsed.snapshot.status).toBe(EAgentStatus.Paused)
    const refused = downgradeAgentOutcome({
      outcome: { ok: false, reason: 'no' },
      capabilities: legacy,
    })
    expect(legacyAgentOutcomeSchema.parse(refused)).toEqual({
      ok: false,
      reason: 'no',
    })
  })

  it('an old read-activity schema parses the reply once the waiting field is stripped', () => {
    const reply = readActivityReplySchema.parse({
      runtimeId: 'r',
      revision: 1,
      turnEpoch: 1,
      working: true,
      awaiting: null,
      observedOutcome: null,
      waitingForModel: waiting,
    })
    const down = downgradeReadActivity({ reply, capabilities: legacy })
    expect(legacyActivitySchema.parse(JSON.parse(JSON.stringify(down))).working).toBe(true)
    expect(down).not.toHaveProperty('waitingForModel')
  })

  it('an old turnOutcomeWireSchema parses a waiting outcome as Failed with actionable text', () => {
    const down = downgradeTurnOutcome({
      outcome: waitingOutcome,
      capabilities: legacy,
    })
    const parsed = legacyTurnOutcomeSchema.parse(JSON.parse(JSON.stringify(down)))
    expect(parsed.status).toBe(ETurnStatus.Failed)
    if (parsed.status !== ETurnStatus.Failed) throw new Error('expected Failed')
    expect(parsed.runId).toBe(waitingOutcome.runId)
    expect(parsed.message).toBe(waitingTextOf(waiting))
    expect(parsed.message).toContain('Waiting for model')
    expect(parsed.message).toContain('anthropic claude')
    expect(parsed.message).toContain('quota')
    expect(parsed.message).toContain('2026-11-02T00:00:00.000Z')
  })

  it('downconverts every serve frame kind that carries agent or outcome data', () => {
    const roster = rosterWireSchema.parse({
      shells: [],
      services: [],
      agents: [snapshotOf(EAgentStatus.WaitingForModel)],
    })
    const frames: ServeFrame[] = [
      { kind: EServeFrame.Roster, roster },
      { kind: EServeFrame.TurnEnded, outcome: waitingOutcome },
      { kind: EServeFrame.Reply, replyTo: 'a', ok: true, data: roster },
      {
        kind: EServeFrame.Reply,
        replyTo: 'b',
        ok: true,
        data: { ok: true, snapshot: snapshotOf(EAgentStatus.WaitingForModel) },
      },
    ]
    for (const frame of frames) {
      const sent = JSON.parse(JSON.stringify(downgradeServeFrame({ frame, capabilities: legacy })))
      expect(serveFrameSchema.safeParse(sent).success).toBe(true)
      if (sent.kind === EServeFrame.Roster) legacyRosterSchema.parse(sent.roster)
      if (sent.kind === EServeFrame.TurnEnded) legacyTurnOutcomeSchema.parse(sent.outcome)
      if (sent.kind === EServeFrame.Reply && 'agents' in sent.data)
        legacyRosterSchema.parse(sent.data)
      if (sent.kind === EServeFrame.Reply && 'snapshot' in sent.data)
        legacyAgentOutcomeSchema.parse(sent.data)
    }
  })

  it('leaves unrelated replies and frames untouched', () => {
    const text: ServeFrame = {
      kind: EServeFrame.Reply,
      replyTo: 'x',
      ok: true,
      data: { ok: true, text: 'hi' },
    }
    expect(downgradeServeFrame({ frame: text, capabilities: legacy })).toEqual(text)
    const error: ServeFrame = { kind: EServeFrame.Error, message: 'boom' }
    expect(downgradeServeFrame({ frame: error, capabilities: legacy })).toEqual(error)
  })
})

describe('a capable client', () => {
  it('receives the untranslated enum on every shape', () => {
    const snapshot = snapshotOf(EAgentStatus.WaitingForModel)
    expect(downgradeAgentSnapshot({ snapshot, capabilities: capable })).toBe(snapshot)
    expect(downgradeTurnOutcome({ outcome: waitingOutcome, capabilities: capable })).toBe(
      waitingOutcome,
    )
    const frame: ServeFrame = {
      kind: EServeFrame.TurnEnded,
      outcome: waitingOutcome,
    }
    expect(downgradeServeFrame({ frame, capabilities: capable })).toBe(frame)
  })

  it('does not alter a non-waiting snapshot or outcome for a legacy peer', () => {
    const running = snapshotOf(EAgentStatus.Running)
    expect(downgradeAgentSnapshot({ snapshot: running, capabilities: legacy })).toBe(running)
    const failed = turnOutcomeWireSchema.parse({
      status: ETurnStatus.Failed,
      runId: 'run-2',
      message: 'x',
    })
    expect(downgradeTurnOutcome({ outcome: failed, capabilities: legacy })).toBe(failed)
  })
})

describe('the protocol and capability', () => {
  it('bumps the channel protocol to 33 and keeps the minimum at 29', () => {
    expect(CHANNEL_PROTOCOL_VERSION).toBe(33)
    expect(CHANNEL_PROTOCOL_MIN_VERSION).toBe(29)
  })

  it('advertises the capability under its wire value', () => {
    expect(String(ECapability.ModelAvailabilityControls)).toBe('model-availability-controls')
    expect(SERVE_CAPABILITIES).toContain(ECapability.ModelAvailabilityControls)
  })
})
