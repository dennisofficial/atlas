import { join } from 'node:path'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { DECLARED_SERVICES_FILE, declaredServicesOf, type DeclaredRead } from '../core/declared'
import { readTextFile, type DaemonCall } from './daemon'

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
}): Promise<DeclaredRead> => {
  const file = declaredFilePath(args.projectDirectory)
  const read = await readOrFailure({ ctx: args.ctx, file, signal: args.signal })
  if (!read.ok) return { ok: false, reason: `there is no readable ${file}: ${read.reason}` }
  const parsed = declaredServicesOf(read.value)
  if (!parsed.ok) return { ok: false, reason: `${file} ${parsed.reason}` }
  return parsed
}
