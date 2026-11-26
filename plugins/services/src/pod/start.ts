import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { ensureDeclared } from './declared-ensure'
import { readDeclared } from './declared-file'
import { failureOutcome } from './failure'
import { launchService } from './launch'
import type { DeclaredPlace } from './place'
import type { ServiceInput } from './schema'
import type { ServicePodState } from './state'

export const startService = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  input: ServiceInput
  projectDirectory: string
  place: DeclaredPlace
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const { ctx, state, input } = args
  if (input.name !== undefined) {
    const declared = await readDeclared({
      ctx,
      projectDirectory: args.place.root,
      signal: args.signal,
    })
    if (!declared.ok) return failureOutcome(declared)
    return ensureDeclared({
      ctx,
      state,
      declared: declared.value,
      name: input.name,
      place: args.place,
      readyTimeoutMs: input.readyTimeoutMs,
      expose: input.exposePort,
      signal: args.signal,
    })
  }
  return launchService({
    ctx,
    state,
    command: input.command ?? '',
    description: input.description ?? input.command ?? '',
    cwd: input.workdir ?? args.projectDirectory,
    port: input.port,
    readyTimeoutMs: input.readyTimeoutMs,
    expose: input.exposePort,
    signal: args.signal,
  })
}
