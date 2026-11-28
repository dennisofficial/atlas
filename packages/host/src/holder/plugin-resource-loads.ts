import { canonicalJson, latestResourceOf, type RecordEvent } from '@dltech/atlas-core'
import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'
import type { PluginPodContext, PodResource } from '@dltech/atlas-plugin-sdk'

import { messageOf } from './plugin-resource-probes'
import type { ELoadReason } from './plugin-resource-reason'

type Ctx = PluginPodContext

type Appended = Parameters<PluginPodContext['append']>[0][number]

export type Loadable = {
  readonly resource: PodResource<unknown>
  readonly fingerprint: string
  readonly reason: ELoadReason
}

const loaded = new WeakMap<object, Map<string, { id: string; fingerprint: string }>>()

const loadedOf = (ctx: Ctx): Map<string, { id: string; fingerprint: string }> => {
  const scope = ctx.runtime ?? ctx
  let state = loaded.get(scope)
  if (state === undefined) {
    state = new Map()
    loaded.set(scope, state)
  }
  return state
}

export const loadedFingerprintOf = (args: {
  ctx: Ctx
  events: readonly RecordEvent[]
  resource: string
}): string | undefined => {
  const latest = args.events.findLast(
    (event) => event.type === 'resource-loaded' && event.resource === args.resource,
  )
  if (latest?.type !== 'resource-loaded') return undefined
  const known = loadedOf(args.ctx).get(`${latest.threadId}:${args.resource}`)
  return known?.id === latest.id ? known.fingerprint : latest.fingerprint
}

const scopeOf = (fingerprint: string): string => fingerprint.replace(/^[^:]+:(?:\d+|unarmed):/, '')

export const draftsOf = <T>(args: {
  resource: PodResource<T>
  ctx: Ctx
  value: T
  fingerprint: string
}): Appended[] => {
  const latest = latestResourceOf({ events: args.ctx.events(), resource: args.resource.name })
  const unchanged =
    latest !== undefined &&
    scopeOf(latest.fingerprint) === scopeOf(args.fingerprint) &&
    canonicalJson(latest.value) === canonicalJson(args.value)
  return [
    ...(unchanged
      ? []
      : [
          {
            type: 'resource-loaded' as const,
            resource: args.resource.name,
            fingerprint: args.fingerprint,
            value: args.value,
          },
        ]),
    ...(args.resource.announce?.(args.value, args.ctx) ?? []),
  ]
}

export const loadedDraftsOf = async <T>(args: {
  resource: PodResource<T>
  ctx: Ctx
  directory: string
  fingerprint: string
}): Promise<Appended[]> => {
  const value = await args.resource.load({ ctx: args.ctx, directory: args.directory })
  const parsed = args.resource.schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`${args.resource.name} loaded a value its own schema refused`)
  }
  return draftsOf({
    resource: args.resource,
    ctx: args.ctx,
    value: parsed.data,
    fingerprint: args.fingerprint,
  })
}

export const appendOf = async (args: {
  ctx: Ctx
  trace: TracePort | undefined
  drafts: readonly Appended[]
}): Promise<void> => {
  if (args.drafts.length === 0) return
  await spanWith(args.trace, {
    name: ESpan.ResourceAppend,
    fields: { drafts: args.drafts.length },
    run: () => args.ctx.append(args.drafts),
  })
}

export const appendLoadedOf = async (args: {
  ctx: Ctx
  trace: TracePort | undefined
  drafts: readonly Appended[]
  resource: string
  fingerprint: string
}): Promise<void> => {
  await appendOf(args)
  const latest = args.ctx
    .events()
    .findLast((event) => event.type === 'resource-loaded' && event.resource === args.resource)
  if (latest === undefined) return
  loadedOf(args.ctx).set(`${latest.threadId}:${args.resource}`, {
    id: latest.id,
    fingerprint: args.fingerprint,
  })
}

export const loadOf = async (args: {
  ctx: Ctx
  trace: TracePort | undefined
  entry: Loadable
  directory: string
}): Promise<void> => {
  try {
    const drafts = await spanWith(args.trace, {
      name: ESpan.ResourceLoad,
      fields: { resource: args.entry.resource.name, phase: args.entry.reason },
      run: () =>
        loadedDraftsOf({
          resource: args.entry.resource,
          ctx: args.ctx,
          directory: args.directory,
          fingerprint: args.entry.fingerprint,
        }),
    })
    await appendLoadedOf({
      ctx: args.ctx,
      trace: args.trace,
      drafts,
      resource: args.entry.resource.name,
      fingerprint: args.entry.fingerprint,
    })
  } catch (failure) {
    args.ctx.log(
      `plugin resource ${args.entry.resource.name} could not load: ${messageOf(failure)}`,
    )
  }
}

export const startInBackground = (args: {
  ctx: Ctx
  trace: TracePort | undefined
  entry: Loadable
  directory: string
}): Promise<void> =>
  spanWith(args.trace, {
    name: ESpan.ResourceLoad,
    fields: { resource: args.entry.resource.name, phase: args.entry.reason },
    run: async () => {
      const drafts = await loadedDraftsOf({
        resource: args.entry.resource,
        ctx: args.ctx,
        directory: args.directory,
        fingerprint: args.entry.fingerprint,
      })
      await appendLoadedOf({
        ctx: args.ctx,
        trace: args.trace,
        drafts,
        resource: args.entry.resource.name,
        fingerprint: args.entry.fingerprint,
      })
    },
  }).catch((failure: unknown) => {
    args.ctx.log(
      `plugin resource ${args.entry.resource.name} could not load in the background: ${messageOf(failure)}`,
    )
  })
