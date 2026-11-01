import { ECapability, supports, type CapabilitySet } from './capabilities'
import { EServeFrame, type ServeFrame } from './channel-wire'
import type { WaitingForModelWire } from './model-availability-wire'
import {
  agentOutcomeWireSchema,
  readActivityReplySchema,
  type AgentOutcomeWire,
  type ReadActivityReply,
} from './request-wire'
import {
  EAgentStatus,
  rosterWireSchema,
  type AgentSnapshotWire,
  type RosterWire,
} from './roster-wire'
import { ETurnStatus, type TurnOutcomeWire } from './turn-outcome-wire'

const WAITING_FOR_MODEL_CAUSE = 'waiting for model access'

export const speaksModelAvailability = (capabilities: CapabilitySet): boolean =>
  supports({ capabilities, capability: ECapability.ModelAvailabilityControls })

export const downgradeAgentSnapshot = (args: {
  snapshot: AgentSnapshotWire
  capabilities: CapabilitySet
}): AgentSnapshotWire => {
  const { snapshot, capabilities } = args
  if (speaksModelAvailability(capabilities)) return snapshot
  if (snapshot.status !== EAgentStatus.WaitingForModel) return snapshot
  return {
    ...snapshot,
    status: EAgentStatus.Paused,
    failureCause: snapshot.failureCause ?? WAITING_FOR_MODEL_CAUSE,
  }
}

export const downgradeRoster = (args: {
  roster: RosterWire
  capabilities: CapabilitySet
}): RosterWire => {
  const { roster, capabilities } = args
  if (speaksModelAvailability(capabilities)) return roster
  return {
    ...roster,
    agents: roster.agents.map((snapshot) => downgradeAgentSnapshot({ snapshot, capabilities })),
  }
}

export const downgradeAgentOutcome = (args: {
  outcome: AgentOutcomeWire
  capabilities: CapabilitySet
}): AgentOutcomeWire => {
  const { outcome, capabilities } = args
  if (!outcome.ok) return outcome
  return {
    ok: true,
    snapshot: downgradeAgentSnapshot({
      snapshot: outcome.snapshot,
      capabilities,
    }),
  }
}

export const downgradeReadActivity = (args: {
  reply: ReadActivityReply
  capabilities: CapabilitySet
}): ReadActivityReply => {
  const { reply, capabilities } = args
  if (speaksModelAvailability(capabilities)) return reply
  const legacy = { ...reply }
  delete legacy.waitingForModel
  return legacy
}

const waitingSubject = (waiting: WaitingForModelWire): string =>
  waiting.modelId === null ? waiting.providerId : `${waiting.providerId} ${waiting.modelId}`

export const waitingTextOf = (waiting: WaitingForModelWire): string => {
  const reason = waiting.reason === null ? '' : ` (${waiting.reason})`
  const reset = waiting.resetAt === null ? '' : ` Provider reset: ${waiting.resetAt}.`
  return `Waiting for model: ${waitingSubject(waiting)} is unavailable${reason}.${reset} Your work is preserved. Check Providers or update this session, then send a message to continue.`
}

export const downgradeTurnOutcome = (args: {
  outcome: TurnOutcomeWire
  capabilities: CapabilitySet
}): TurnOutcomeWire => {
  const { outcome, capabilities } = args
  if (speaksModelAvailability(capabilities)) return outcome
  if (outcome.status !== ETurnStatus.WaitingForModel) return outcome
  return {
    status: ETurnStatus.Failed,
    runId: outcome.runId,
    message: waitingTextOf(outcome.waiting),
  }
}

const downgradedReplyData = (args: { data: unknown; capabilities: CapabilitySet }): unknown => {
  const { data, capabilities } = args
  const roster = rosterWireSchema.safeParse(data)
  if (roster.success) return downgradeRoster({ roster: roster.data, capabilities })
  const outcome = agentOutcomeWireSchema.safeParse(data)
  if (outcome.success) return downgradeAgentOutcome({ outcome: outcome.data, capabilities })
  const activity = readActivityReplySchema.safeParse(data)
  if (activity.success) return downgradeReadActivity({ reply: activity.data, capabilities })
  return data
}

export const downgradeServeFrame = (args: {
  frame: ServeFrame
  capabilities: CapabilitySet
}): ServeFrame => {
  const { frame, capabilities } = args
  if (speaksModelAvailability(capabilities)) return frame
  if (frame.kind === EServeFrame.Roster) {
    return {
      ...frame,
      roster: downgradeRoster({ roster: frame.roster, capabilities }),
    }
  }
  if (frame.kind === EServeFrame.TurnEnded) {
    return {
      ...frame,
      outcome: downgradeTurnOutcome({ outcome: frame.outcome, capabilities }),
    }
  }
  if (frame.kind === EServeFrame.Reply) {
    return {
      ...frame,
      data: downgradedReplyData({ data: frame.data, capabilities }),
    }
  }
  return frame
}
