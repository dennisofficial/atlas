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

export const draftsOf = <T>(args: {
  resource: PodResource<T>
  ctx: Ctx
  value: T
  fingerprint: string
}): Appended[] => [
  {
    type: 'resource-loaded',
    resource: args.resource.name,
    fingerprint: args.fingerprint,
    value: args.value,
  },
  ...(args.resource.announce?.(args.value, args.ctx) ?? []),
]

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

export const loadOf = async (args: {
  ctx: Ctx
  trace: TracePort | undefined
  entry: Loadable
  directory: string
}): Promise<readonly Appended[]> => {
  try {
    return await spanWith(args.trace, {
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
  } catch (failure) {
    args.ctx.log(
      `plugin resource ${args.entry.resource.name} could not load: ${messageOf(failure)}`,
    )
    return []
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
      await args.ctx.append(drafts)
    },
  }).catch((failure: unknown) => {
    args.ctx.log(
      `plugin resource ${args.entry.resource.name} could not load in the background: ${messageOf(failure)}`,
    )
  })
