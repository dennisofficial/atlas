import { readdir, realpath, stat } from 'node:fs/promises'
import { join, relative as relativeTo } from 'node:path'

import {
  EPatternSegment,
  compileWorktreePattern,
  segmentMatches,
  type PatternSegment,
} from '@dltech/atlas-core'

const GIT_ENTRY = '.git'

type Entry = { name: string; directory: boolean; symlink: boolean }

const entriesOf = async (directory: string): Promise<readonly Entry[] | undefined> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      directory: entry.isDirectory(),
      symlink: entry.isSymbolicLink(),
    }))
  } catch {
    return undefined
  }
}

const childOf = (args: { relative: string; name: string }): string =>
  args.relative === '' ? args.name : `${args.relative}/${args.name}`

type Walk = {
  root: string
  realRoot: string
  skip: ReadonlySet<string>
  found: Set<string>
  escaped: Set<string>
}

export type PatternMatches = { paths: readonly string[]; escaped: readonly string[] }

const isInside = (args: { root: string; path: string }): boolean => {
  const relation = relativeTo(args.root, args.path)
  return !relation.startsWith('..') && !relation.startsWith('/')
}

const traversable = async (args: { walk: Walk; entry: Entry; child: string }): Promise<boolean> => {
  if (!args.entry.symlink) return args.entry.directory
  try {
    const target = await realpath(join(args.walk.root, args.child))
    if (!isInside({ root: args.walk.realRoot, path: target })) {
      args.walk.escaped.add(args.child)
      return false
    }
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

const walk = async (args: {
  walk: Walk
  segments: readonly PatternSegment[]
  relative: string
}): Promise<void> => {
  const { walk: state, segments, relative } = args
  const [segment, ...rest] = segments
  if (segment === undefined) {
    if (relative !== '') state.found.add(relative)
    return
  }

  const entries = await entriesOf(join(state.root, relative))
  if (entries === undefined) return
  if (relative !== '' && entries.some((entry) => entry.name === GIT_ENTRY)) return

  if (segment.kind === EPatternSegment.Globstar) {
    await walk({ walk: state, segments: rest, relative })
  }

  for (const entry of entries) {
    if (entry.name === GIT_ENTRY) continue
    const child = childOf({ relative, name: entry.name })
    if (state.skip.has(child)) continue
    if (segment.kind === EPatternSegment.Globstar) {
      if (entry.directory) await walk({ walk: state, segments, relative: child })
      continue
    }
    if (!segmentMatches({ segment, name: entry.name })) continue
    if (rest.length > 0 && !(await traversable({ walk: state, entry, child }))) continue
    await walk({ walk: state, segments: rest, relative: child })
  }
}

export async function matchWorktreePattern({
  root,
  pattern,
  skip,
}: {
  root: string
  pattern: string
  skip: ReadonlySet<string>
}): Promise<PatternMatches> {
  const state: Walk = {
    root,
    realRoot: await realpath(root),
    skip,
    found: new Set(),
    escaped: new Set(),
  }
  await walk({ walk: state, segments: compileWorktreePattern(pattern), relative: '' })
  return { paths: [...state.found].sort(), escaped: [...state.escaped].sort() }
}
