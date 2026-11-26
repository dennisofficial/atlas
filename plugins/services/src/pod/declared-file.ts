import { join } from 'node:path'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { DECLARED_SERVICES_FILE, declaredServicesOf, type DeclaredServices } from '../core/declared'
import { readTextFile, type DaemonCall } from './daemon'
import { EServiceFailure, serviceFailed, type ServiceFailed } from './failure'

export const declaredFilePath = (projectDirectory: string): string =>
  join(projectDirectory, ...DECLARED_SERVICES_FILE)

const readOrFailure = async (args: {
  ctx: PluginPodContext
  file: string
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<string>> => {
  try {
    return await readTextFile({ ctx: args.ctx, path: args.file, signal: args.signal })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export const readDeclared = async (args: {
  ctx: PluginPodContext
  projectDirectory: string
  signal?: AbortSignal | undefined
}): Promise<{ ok: true; value: DeclaredServices } | ServiceFailed> => {
  const file = declaredFilePath(args.projectDirectory)
  const read = await readOrFailure({ ctx: args.ctx, file, signal: args.signal })
  if (!read.ok) {
    return serviceFailed({
      reason: `there is no readable ${file}: ${read.reason}`,
      failure: EServiceFailure.NotDeclared,
    })
  }
  const parsed = declaredServicesOf(read.value)
  if (!parsed.ok) {
    return serviceFailed({
      reason: `${file} ${parsed.reason}`,
      failure: EServiceFailure.InvalidDeclaration,
    })
  }
  return parsed
}
