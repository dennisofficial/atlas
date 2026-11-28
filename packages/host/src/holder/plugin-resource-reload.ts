import { resourceFingerprintOf } from '@dltech/atlas-core'
import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'
import type { PluginPodContext, PodResource } from '@dltech/atlas-plugin-sdk'

import { armOf, cloudStringOf, messageOf, statusOf, versionsOf } from './plugin-resource-probes'
import { ELoadReason } from './plugin-resource-reason'
import { appendLoadedOf, loadedDraftsOf } from './plugin-resource-loads'
import { watchOf } from './plugin-resource-refresh'

type Ctx = PluginPodContext

export const reloadOne = async (args: {
  ctx: Ctx
  trace: TracePort | undefined
  resource: PodResource<unknown>
  directory: string
  reason: ELoadReason
  onUnreached?: (() => void) | undefined
}): Promise<void> => {
  const watch = watchOf({ resource: args.resource, directory: args.directory })
  const [status, versions] = await Promise.all([
    spanWith(args.trace, {
      name: ESpan.ResourceStatus,
      run: () => statusOf({ ctx: args.ctx, watchIds: watch === undefined ? [] : [watch.id] }),
    }),
    spanWith(args.trace, {
      name: ESpan.ResourceVersions,
      run: () => versionsOf({ ctx: args.ctx, needed: args.resource.cloud !== undefined }),
    }),
  ])
  if (status.unreachable) {
    args.ctx.log(
      `plugin resource ${args.resource.name} left as it is: the sandbox did not answer the watch status call`,
    )
    args.onUnreached?.()
    return
  }
  let seq = watch === undefined ? undefined : status.seqs.get(watch.id)
  if (watch !== undefined && seq === undefined) {
    const reachable = await spanWith(args.trace, {
      name: ESpan.ResourceArm,
      fields: { resource: args.resource.name },
      run: () => armOf({ ctx: args.ctx, watchId: watch.id, watch: watch.spec }),
    })
    if (!reachable) {
      args.ctx.log(
        `plugin resource ${args.resource.name} left as it is: the sandbox did not answer the watch arm call`,
      )
      args.onUnreached?.()
      return
    }
    seq = 0
  }
  const fingerprint = resourceFingerprintOf({
    instance: status.instance,
    seq,
    cloud: cloudStringOf({ settings: args.resource.cloud, versions }),
    directory: args.directory,
  })
  try {
    const drafts = await spanWith(args.trace, {
      name: ESpan.ResourceLoad,
      fields: { resource: args.resource.name, phase: args.reason },
      run: () =>
        loadedDraftsOf({
          resource: args.resource,
          ctx: args.ctx,
          directory: args.directory,
          fingerprint,
        }),
    })
    await appendLoadedOf({
      ctx: args.ctx,
      trace: args.trace,
      drafts,
      resource: args.resource.name,
      fingerprint,
    })
  } catch (failure) {
    args.ctx.log(`plugin resource ${args.resource.name} could not reload: ${messageOf(failure)}`)
  }
}
