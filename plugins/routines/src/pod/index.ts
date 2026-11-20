import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { RoutineTool } from './tool'

export const ROUTINE_TOOLS = ['routine'] as const

export const routinesPod: PodSlot = {
  ...EMPTY_POD,
  tools: (ctx) => [new RoutineTool(ctx)],
}
