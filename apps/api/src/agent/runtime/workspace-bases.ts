import type { CapturedBase } from '@dltech/atlas-host'
import type { FileSystemPort } from '@dltech/atlas-core'

import { fail, report, type Deps } from './workspace-state'

const isCapturedBase = (value: unknown): value is CapturedBase =>
  typeof value === 'object' &&
  value !== null &&
  'repoPath' in value &&
  'base' in value &&
  typeof value.repoPath === 'string' &&
  typeof value.base === 'string'

export enum ECapturedBasesState {
  Absent = 'absent',
  Corrupt = 'corrupt',
  Present = 'present',
}

export type CapturedBasesRead =
  | { readonly state: ECapturedBasesState.Absent }
  | { readonly state: ECapturedBasesState.Corrupt; readonly detail: string }
  | { readonly state: ECapturedBasesState.Present; readonly bases: readonly CapturedBase[] }

const partialPathOf = (path: string): string => `${path}.partial`

const parseBases = (text: string): readonly CapturedBase[] | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const bases = parsed.filter(isCapturedBase)
  return bases.length === parsed.length ? bases : null
}

export const writeCapturedBases = async (args: {
  files: FileSystemPort
  path: string
  bases: readonly CapturedBase[]
}): Promise<boolean> => {
  const content = JSON.stringify(args.bases)
  const partial = partialPathOf(args.path)
  try {
    await args.files.writeFile({ path: partial, content })
    await args.files.rename({ from: partial, to: args.path })
  } catch {
    await args.files.removeFile({ path: partial }).catch(() => undefined)
    return false
  }
  const readBack = await args.files.readFile({ path: args.path }).catch(() => null)
  return readBack === content
}

export const readCapturedBases = async (args: {
  files: FileSystemPort
  path: string
}): Promise<CapturedBasesRead> => {
  const text = await args.files.readFile({ path: args.path }).catch(() => null)
  if (text === null) return { state: ECapturedBasesState.Absent }
  const bases = parseBases(text)
  if (bases === null) return { state: ECapturedBasesState.Corrupt, detail: args.path }
  return { state: ECapturedBasesState.Present, bases }
}

export const replayCapturedBases = async (args: {
  deps: Deps
  path: string
  expectedRepos: number
}): Promise<readonly CapturedBase[]> => {
  const read = await readCapturedBases({ files: args.deps.files, path: args.path })
  if (read.state === ECapturedBasesState.Corrupt) {
    fail({
      deps: args.deps,
      message: 'the captured session bases are unreadable; diffs fall back to the base branch',
      detail: read.detail,
    })
    report({
      deps: args.deps,
      message: 'the captured session bases are unreadable',
      detail: read.detail,
    })
    return []
  }
  const bases = read.state === ECapturedBasesState.Present ? read.bases : []
  if (bases.length === 0 && args.expectedRepos > 0) {
    report({
      deps: args.deps,
      message: 'the materialized workspace holds no captured session bases',
      detail: args.path,
    })
  }
  return bases
}
