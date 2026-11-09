import { EAgentStatus, type Event, type PluginViewFold, type V2Event } from '@dltech/atlas-core'
import { z } from 'zod'

export const CREW_VIEW = 'crew'

export const crewRowSchema = z.object({
  agentId: z.string(),
  agentType: z.string(),
  intent: z.string(),
  status: z.enum(EAgentStatus),
  turns: z.number().int(),
  toolCalls: z.number().int(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  prose: z.string().optional(),
  worktree: z.object({ path: z.string(), branch: z.string() }).optional(),
})

export const crewViewSchema = z.array(crewRowSchema).readonly()

export type CrewRow = z.infer<typeof crewRowSchema>
export type CrewViewState = readonly CrewRow[]

const upsert = (state: CrewViewState, row: CrewRow): CrewViewState =>
  state.some((kept) => kept.agentId === row.agentId)
    ? state.map((kept) => (kept.agentId === row.agentId ? row : kept))
    : [...state, row]

const rowFor = (state: CrewViewState, agentId: string): CrewRow | undefined =>
  state.find((kept) => kept.agentId === agentId)

export const foldCrew = (state: CrewViewState, event: Event | V2Event): CrewViewState => {
  if (event.type === 'agent-spawned') {
    return upsert(state, {
      agentId: event.agentId,
      agentType: event.agentType,
      intent: event.intent,
      status: EAgentStatus.Running,
      turns: 0,
      toolCalls: 0,
      startedAt: event.at,
      ...(event.worktree === undefined ? {} : { worktree: event.worktree }),
    })
  }
  if (event.type === 'agent-restarted') {
    const existing = rowFor(state, event.agentId)
    return upsert(state, {
      agentId: event.agentId,
      agentType: existing?.agentType ?? event.agentType,
      intent: existing?.intent ?? event.intent,
      status: EAgentStatus.Running,
      turns: existing?.turns ?? 0,
      toolCalls: existing?.toolCalls ?? 0,
      startedAt: existing?.startedAt ?? event.at,
      ...(existing?.prose === undefined ? {} : { prose: existing.prose }),
      ...(existing?.worktree === undefined ? {} : { worktree: existing.worktree }),
    })
  }
  if (event.type === 'agent-ended') {
    const existing = rowFor(state, event.agentId)
    return upsert(state, {
      ...(existing ?? {
        agentId: event.agentId,
        agentType: event.agentType,
        intent: event.intent,
        startedAt: event.at,
      }),
      status: event.status,
      turns: event.turns,
      toolCalls: event.toolCalls,
      prose: event.prose,
      endedAt: event.at,
    })
  }
  if (event.type === 'agent-reported') {
    const existing = rowFor(state, event.agentId)
    return upsert(state, {
      ...(existing ?? {
        agentId: event.agentId,
        agentType: event.agentType,
        intent: event.intent,
        status: EAgentStatus.Running,
        turns: 0,
        toolCalls: 0,
        startedAt: event.at,
      }),
      prose: event.prose,
    })
  }
  return state
}

export const crewView: PluginViewFold<CrewViewState> = {
  name: CREW_VIEW,
  initial: [],
  fold: foldCrew,
}

export const crewOfEvents = (events: readonly (Event | V2Event)[]): CrewViewState =>
  events.reduce(foldCrew, crewView.initial)
