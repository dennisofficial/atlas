import { readResource, type PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { buildCatalogue, catalogueOfSnapshot, type SkillCatalogue } from './catalogue'
import { skillsResource, type SkillsPodOptions } from './resources'

type Ctx = PluginPodContext

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const catalogueOf = async (args: {
  ctx: Ctx
  options: SkillsPodOptions
  directory?: string | undefined
  signal?: AbortSignal | undefined
}): Promise<SkillCatalogue | null> => {
  const snapshot = readResource({ ctx: args.ctx, resource: skillsResource(args.options) })
  if (
    snapshot !== undefined &&
    (args.directory === undefined || snapshot.directory === args.directory)
  )
    return catalogueOfSnapshot(snapshot)
  if (args.directory === undefined) return null

  return await buildCatalogue({
    ctx: args.ctx,
    cloud: args.options.cloud(args.ctx),
    directory: args.directory,
    signal: args.signal,
  }).catch((error: unknown) => {
    args.ctx.log(`skills could not be read: ${messageOf(error)}`)
    return null
  })
}
