import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

export const serviceEnvOf = async (args: {
  ctx: PluginPodContext
  env?: Record<string, string> | undefined
}): Promise<Record<string, string>> => ({
  ...((await args.ctx.env?.()) ?? {}),
  ...(args.env ?? {}),
})
