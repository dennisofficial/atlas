import type { CapturedBase } from '@dltech/atlas-host'
import type { FileSystemPort } from '@dltech/atlas-core'

import { report, type Deps } from './workspace-state'

const isCapturedBase = (value: unknown): value is CapturedBase =>
  typeof value === 'object' &&
  value !== null &&
  'repoPath' in value &&
  'base' in value &&
  typeof value.repoPath === 'string' &&
  typeof value.base === 'string'

export const writeCapturedBases = async (args: {
  files: FileSystemPort
  path: string
  bases: readonly CapturedBase[]
}): Promise<boolean> => {
  try {
    await args.files.writeFile({ path: args.path, content: JSON.stringify(args.bases) })
    return true
  } catch {
    return false
  }
}

export const readCapturedBases = async (args: {
  files: FileSystemPort
  path: string
}): Promise<readonly CapturedBase[]> => {
  const text = await args.files.readFile({ path: args.path }).catch(() => null)
  if (text === null) return []
  const parsed: unknown = ((): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  })()
  return Array.isArray(parsed) ? parsed.filter(isCapturedBase) : []
}

export const replayCapturedBases = async (args: {
  deps: Deps
  path: string
  expectedRepos: number
}): Promise<readonly CapturedBase[]> => {
  const bases = await readCapturedBases({ files: args.deps.files, path: args.path })
  if (bases.length === 0 && args.expectedRepos > 0) {
    report({
      deps: args.deps,
      message: 'the materialized workspace holds no captured session bases',
      detail: args.path,
    })
  }
  return bases
}
