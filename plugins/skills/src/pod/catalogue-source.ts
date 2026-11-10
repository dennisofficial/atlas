import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { buildCatalogue, type SkillCatalogue } from './catalogue'
import type { CloudSkillSource } from './port'
import type { SkillsPodState } from './state'

type Ctx = Pick<PluginPodContext, 'call' | 'log'>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const catalogueFor = async (args: {
  ctx: Ctx
  state: SkillsPodState
  cloud: CloudSkillSource
  directory: string
  refresh?: boolean
  signal?: AbortSignal | undefined
}): Promise<SkillCatalogue | null> => {
  const { state } = args
  if (args.refresh !== true && state.catalogue?.directory === args.directory) return state.catalogue
  if (state.loading?.directory === args.directory) return await state.loading.promise

  const promise = buildCatalogue({
    ctx: args.ctx,
    cloud: args.cloud,
    directory: args.directory,
    signal: args.signal,
  })
    .catch((error: unknown) => {
      args.ctx.log(`skills could not be read: ${messageOf(error)}`)
      return null
    })
    .finally(() => {
      state.loading = null
    })

  state.loading = { directory: args.directory, promise }
  const built = await promise
  if (built !== null) state.catalogue = built
  return built
}
