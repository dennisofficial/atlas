import { dirname, join, resolve } from 'node:path'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { statOf } from './daemon'

type Ctx = Pick<PluginPodContext, 'call'>

export const INSTRUCTION_FILE = 'AGENTS.md'

export const MAX_INSTRUCTION_BYTES = 100 * 1024

const GIT_MARK = '.git'

const PATH_FIELDS = ['path', 'file_path', 'workdir'] as const

const selfAndParentsOf = (directory: string): readonly string[] => {
  const candidates: string[] = []
  let current = directory
  for (;;) {
    candidates.push(current)
    const parent = dirname(current)
    if (parent === current) return candidates
    current = parent
  }
}

export const repoRootOf = async (args: { ctx: Ctx; directory: string }): Promise<string> => {
  const candidates = selfAndParentsOf(args.directory)
  const marks = await Promise.all(
    candidates.map(
      async (candidate) => await statOf({ ctx: args.ctx, path: join(candidate, GIT_MARK) }),
    ),
  )
  const found = marks.findIndex((mark) => mark.ok)
  return (found === -1 ? undefined : candidates[found]) ?? args.directory
}

const segmentsBelow = (args: { root: string; path: string }): readonly string[] | null => {
  if (args.path === args.root) return []
  const prefix = args.root.endsWith('/') ? args.root : `${args.root}/`
  if (!args.path.startsWith(prefix)) return null
  const rest = args.path.slice(prefix.length).replace(/\/+$/, '')
  if (rest === '') return []
  return rest.split('/').filter((segment) => segment !== '')
}

const ancestorsOf = (args: { root: string; path: string }): readonly string[] => {
  const segments = segmentsBelow(args)
  if (segments === null) return []
  const directories: string[] = []
  let current = args.root
  for (const segment of segments) {
    current = join(current, segment)
    directories.push(current)
  }
  return directories
}

export const descentOf = (args: { root: string; directory: string }): readonly string[] =>
  segmentsBelow({ root: args.root, path: args.directory }) === null
    ? [args.directory]
    : [args.root, ...ancestorsOf({ root: args.root, path: args.directory })]

export const nestedDirectoriesOf = (args: {
  root: string
  covered: readonly string[]
  touched: readonly string[]
}): readonly string[] => {
  const taken = new Set(args.covered)
  const candidates = new Set<string>()
  for (const touched of args.touched) {
    for (const directory of ancestorsOf({ root: args.root, path: touched })) {
      if (!taken.has(directory)) candidates.add(directory)
    }
  }
  return [...candidates].sort(
    (left, right) => depthOf(left) - depthOf(right) || (left < right ? -1 : 1),
  )
}

const depthOf = (path: string): number => path.split('/').filter((part) => part !== '').length

export const touchedDirectoriesOf = (args: {
  input: unknown
  projectDirectory: string
}): readonly string[] => {
  if (typeof args.input !== 'object' || args.input === null) return []
  const record = args.input as Record<string, unknown>
  const directories = new Set<string>()
  for (const field of PATH_FIELDS) {
    const value = record[field]
    if (typeof value !== 'string' || value === '') continue
    const path = resolve(args.projectDirectory, value)
    directories.add(path)
    directories.add(dirname(path))
  }
  return [...directories]
}
