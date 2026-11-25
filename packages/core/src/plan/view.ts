import { z } from 'zod'

import type { RecordEvent } from '../record/event'
import type { PluginViewFold } from '../record/views/plugin-view'
import { EPlanStatus, PLAN_TOOL_NAME, planInputSchema, planTasks, type PlanTask } from './plan'

export const PLAN_VIEW = 'plan'

const planTaskSchema = z.object({
  ordinal: z.number().int().min(1),
  text: z.string().min(1),
  status: z.enum(EPlanStatus),
  activeForm: z.string().min(1).optional(),
})

export type PlanViewState = {
  tasks: readonly PlanTask[]
  pending: Readonly<Record<string, readonly PlanTask[]>>
}

export const planViewSchema = z.object({
  tasks: z.array(planTaskSchema).readonly(),
  pending: z.record(z.string(), z.array(planTaskSchema).readonly()).readonly(),
})

const initial: PlanViewState = { tasks: [], pending: {} }

const settled = (state: PlanViewState, callId: string): PlanViewState => {
  if (!Object.hasOwn(state.pending, callId)) return state
  const pending = Object.fromEntries(
    Object.entries(state.pending).filter(([key]) => key !== callId),
  ) as Readonly<Record<string, readonly PlanTask[]>>
  return { tasks: state.tasks, pending }
}

const fold = (state: PlanViewState, event: RecordEvent): PlanViewState => {
  if (event.type === 'tool-called') {
    if (event.name !== PLAN_TOOL_NAME) return state
    const parsed = planInputSchema.safeParse(event.input)
    if (!parsed.success) return state
    return {
      tasks: state.tasks,
      pending: { ...state.pending, [event.callId]: planTasks(parsed.data.tasks) },
    }
  }

  if (event.type === 'tool-result') {
    const written = state.pending[event.callId]
    if (written === undefined) return state
    if (event.error !== undefined || event.interrupted === true) return settled(state, event.callId)
    return { tasks: written, pending: settled(state, event.callId).pending }
  }

  if (event.type === 'tool-denied') return settled(state, event.callId)

  return state
}

export const planView: PluginViewFold<PlanViewState> = {
  name: PLAN_VIEW,
  initial,
  rewindable: true,
  fold,
}
