import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'
import type { PluginPodContext, PodResource } from '@dltech/atlas-plugin-sdk'

export const RELOADED = 'reloaded'

type Ctx = PluginPodContext

type Appended = Parameters<Ctx['append']>[0][number]

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
