import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { RoutineCreateTool } from './create-tool'
import { RoutineDeleteTool } from './delete-tool'
import { RoutineListTool } from './list-tool'
import { RoutineRunTool } from './run-tool'
import { RoutineUpdateTool } from './update-tool'

export const ROUTINE_TOOLS = [
  'routine_list',
  'routine_create',
  'routine_update',
  'routine_delete',
  'routine_run',
] as const

export const routinesPod: PodSlot = {
  ...EMPTY_POD,
  tools: (ctx) => [
    new RoutineListTool(ctx),
    new RoutineCreateTool(ctx),
    new RoutineUpdateTool(ctx),
    new RoutineDeleteTool(ctx),
    new RoutineRunTool(ctx),
  ],
}
