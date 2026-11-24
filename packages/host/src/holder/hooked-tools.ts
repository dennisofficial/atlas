import { HookedToolDispatcher, type HookChain, type ToolRegistry } from '@dltech/atlas-agent'
import type { TracePort } from '@dltech/atlas-observability'

export const hookedToolsOf = (args: {
  registry: ToolRegistry
  hooks: HookChain
  trace?: TracePort | undefined
}): HookedToolDispatcher =>
  new HookedToolDispatcher({
    registry: args.registry,
    hooks: args.hooks,
    ...(args.trace === undefined ? {} : { trace: args.trace }),
  })
