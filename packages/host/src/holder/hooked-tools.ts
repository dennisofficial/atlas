import {
  HookedToolDispatcher,
  type HookChain,
  type QualityStagePort,
  type ToolRegistry,
} from '@dltech/atlas-agent'
import type { TracePort } from '@dltech/atlas-observability'

export const hookedToolsOf = (args: {
  registry: ToolRegistry
  hooks: HookChain
  quality?: QualityStagePort | undefined
  trace?: TracePort | undefined
}): HookedToolDispatcher =>
  new HookedToolDispatcher({
    registry: args.registry,
    hooks: args.hooks,
    ...(args.quality === undefined ? {} : { quality: args.quality }),
    ...(args.trace === undefined ? {} : { trace: args.trace }),
  })
