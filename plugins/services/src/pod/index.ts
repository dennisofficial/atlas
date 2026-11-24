import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { service } from '../core/commands'
import { serviceHandlerOf } from './commands'
import { ServicesFragment } from './fragment'
import { recordServiceFrame } from './frames'
import { reconcileServices } from './reconcile'
import { resumeDeclaredServices } from './resume'
import { stateFor } from './state'
import { ServiceTool } from './tool'

export { ServicesFragment } from './fragment'

export const SERVICE_TOOLS = ['service'] as const

export const servicesPod: PodSlot = {
  ...EMPTY_POD,
  tools: (ctx) => [new ServiceTool(ctx, stateFor(ctx))],
  hooks: (ctx) => {
    const state = stateFor(ctx)
    ctx.onDaemonEvent((frame) => void recordServiceFrame({ ctx, state, frame }))
    void reconcileServices({ ctx, state })
    return {}
  },
  onDaemonReady: ({ ctx }) => {
    void resumeDeclaredServices({ ctx, state: stateFor(ctx) })
  },
  commands: (ctx) => new Map([[service.inboxKind, serviceHandlerOf(ctx)]]),
  prompts: [new ServicesFragment()],
}
