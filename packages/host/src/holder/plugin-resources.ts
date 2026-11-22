import type { RegisteredHook } from '@dltech/atlas-agent'
import { latestResourceOf, EStage, type BeforeTurn, type V2Event } from '@dltech/atlas-core'
import type { TracePort } from '@dltech/atlas-observability'
import type { PluginPodContext, PodResource } from '@dltech/atlas-plugin-sdk'

import { messageOf } from './plugin-resource-probes'
import { loadedDraftsOf, refresh, RELOADED } from './plugin-resource-refresh'

type Ctx = PluginPodContext

const inFlight = new WeakMap<Ctx, Promise<void>>()

export const reloadResource = async (args: {
  ctx: Ctx
  resource: PodResource<unknown>
  directory: string
}): Promise<void> => {
  try {
    const drafts = await loadedDraftsOf({
      resource: args.resource,
      ctx: args.ctx,
      directory: args.directory,
      fingerprint: RELOADED,
    })
    await args.ctx.append(drafts)
  } catch (failure) {
    args.ctx.log(`plugin resource ${args.resource.name} could not reload: ${messageOf(failure)}`)
  }
}

export const refreshInFlightOf = (ctx: Ctx): Promise<void> | undefined => inFlight.get(ctx)

type RefreshArgs = {
  ctx: Ctx
  resources: readonly PodResource<unknown>[]
  projectDirectory: string
  trace: TracePort | undefined
  shared: (() => readonly V2Event[]) | undefined
}

const refreshOnce = (args: RefreshArgs): Promise<void> => {
  const running = inFlight.get(args.ctx)
  if (running !== undefined) return running
  const attempt = refresh(args).finally(() => inFlight.delete(args.ctx))
  inFlight.set(args.ctx, attempt)
  return attempt
}

const recordedOf = (args: {
  resource: PodResource<unknown>
  events: readonly V2Event[]
}): boolean => {
  const latest = latestResourceOf({ events: args.events, resource: args.resource.name })
  if (latest === undefined) return false
  const parsed = args.resource.schema.safeParse(latest.value)
  return parsed.success && args.resource.stale?.(parsed.data) !== true
}

const everyRecordedOf = (args: {
  resources: readonly PodResource<unknown>[]
  events: readonly V2Event[]
}): boolean =>
  args.resources.every(
    (resource) => resource.background === true || recordedOf({ resource, events: args.events }),
  )

export const pluginResourcesHook = (args: {
  ctx: Ctx
  resources: readonly PodResource<unknown>[]
  trace?: TracePort | undefined
  shared?: (() => readonly V2Event[]) | undefined
}): RegisteredHook<BeforeTurn> => ({
  name: 'plugin-resources',
  order: { stage: EStage.Guard, nudge: 0 },
  awaited: true,
  run: async ({ projectDirectory }) => {
    const refreshArgs: RefreshArgs = {
      ctx: args.ctx,
      resources: args.resources,
      projectDirectory,
      trace: args.trace,
      shared: args.shared,
    }
    if (everyRecordedOf({ resources: args.resources, events: args.ctx.events() })) {
      void refreshOnce(refreshArgs).catch((failure: unknown) => {
        args.ctx.log(`plugin resources could not refresh: ${messageOf(failure)}`)
      })
      return {}
    }
    await refreshOnce(refreshArgs)
    return {}
  },
})
