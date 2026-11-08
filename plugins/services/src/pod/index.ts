import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { ServicesFragment } from './fragment'
import { recordServiceFrame } from './frames'
import { ServiceListTool } from './list-tool'
import { ServiceRestartTool } from './restart-tool'
import { ServiceStartTool } from './start-tool'
import { stateFor } from './state'
import { ServiceStopTool } from './stop-tool'

export { ServicesFragment } from './fragment'

export const SERVICE_TOOLS = [
  'service_start',
  'service_stop',
  'service_restart',
  'service_list',
] as const

export const servicesPod: PodSlot = {
  ...EMPTY_POD,
  tools: (ctx) => {
    const state = stateFor(ctx)
    return [
      new ServiceStartTool(ctx, state),
      new ServiceStopTool(ctx, state),
      new ServiceRestartTool(ctx, state),
      new ServiceListTool(ctx),
    ]
  },
  hooks: (ctx) => {
    const state = stateFor(ctx)
    ctx.onDaemonEvent((frame) => void recordServiceFrame({ ctx, state, frame }))
    return {}
  },
  prompts: [new ServicesFragment()],
  commands: new Map(),
}
