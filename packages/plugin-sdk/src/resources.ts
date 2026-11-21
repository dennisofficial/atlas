import { latestResourceOf, type EventDraft, type PluginEventBody } from '@dltech/atlas-core'
import type { z } from 'zod'

import type { PluginPodContext } from './slots'

export enum ECloudSetting {
  McpServers = 'mcp-servers',
  Skills = 'skills',
  PersonalInstructions = 'personal-instructions',
}

export type ResourceWatch = {
  roots: readonly string[]
  basenames?: readonly string[] | undefined
}

export type PodResource<T> = {
  name: string
  schema: z.ZodType<T>
  watch?: ((directory: string) => ResourceWatch) | undefined
  cloud?: readonly ECloudSetting[] | undefined
  background?: boolean | undefined
  announce?(value: T, ctx: PluginPodContext): readonly (EventDraft | PluginEventBody)[]
  stale?(value: T): boolean
  load(args: {
    ctx: PluginPodContext
    directory: string
    signal?: AbortSignal | undefined
  }): Promise<T>
}

export type PodResources = { reload(name: string): Promise<void> }

export const UNVERSIONED_SETTINGS: Readonly<Record<ECloudSetting, string>> = Object.freeze({
  [ECloudSetting.McpServers]: 'unversioned',
  [ECloudSetting.Skills]: 'unversioned',
  [ECloudSetting.PersonalInstructions]: 'unversioned',
})

export const EMPTY_POD_RESOURCES: PodResources = { reload: async () => undefined }

export const readResource = <T>(args: {
  ctx: Pick<PluginPodContext, 'events'>
  resource: PodResource<T>
}): T | undefined => {
  const latest = latestResourceOf({ events: args.ctx.events(), resource: args.resource.name })
  if (latest === undefined) return undefined
  const parsed = args.resource.schema.safeParse(latest.value)
  return parsed.success ? parsed.data : undefined
}
