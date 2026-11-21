import { dirname, isAbsolute, join } from 'node:path'

import type { V2Event } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { statOf } from './daemon'

type Ctx = Pick<PluginPodContext, 'call'>

export const INSTRUCTION_FILE = 'AGENTS.md'

export const MAX_INSTRUCTION_BYTES = 100 * 1024

const GIT_MARK = '.git'

const PATH_FIELDS = ['path', 'file_path', 'workdir'] as const

export const repoRootOf = async (args: { ctx: Ctx; directory: string }): Promise<string> => {
  let current = args.directory
  for (;;) {
    const found = await statOf({ ctx: args.ctx, path: join(current, GIT_MARK) })
    if (found.ok) return current
    const parent = dirname(current)
    if (parent === current) return args.directory
    current = parent
  }
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

export const touchedDirectoriesOf = (input: unknown): readonly string[] => {
  if (typeof input !== 'object' || input === null) return []
  const record = input as Record<string, unknown>
  const directories = new Set<string>()
  for (const field of PATH_FIELDS) {
    const value = record[field]
    if (typeof value !== 'string' || !isAbsolute(value)) continue
    directories.add(value)
    directories.add(dirname(value))
  }
  return [...directories]
}

export const touchedSincePromptOf = (events: readonly V2Event[]): readonly string[] => {
  const directories = new Set<string>()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'user-said') break
    if (event.type !== 'tool-called') continue
    for (const directory of touchedDirectoriesOf(event.input)) directories.add(directory)
  }
  return [...directories]
}
