import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureGit } from './capture-git'

const CLOUD_INCLUDE_PATH = join('.atlas', '.cloudinclude')

const splitNull = (text: string): string[] => text.split('\0').filter((entry) => entry.length > 0)

async function listIgnoredEntries({ cwd }: { cwd: string }): Promise<{ dirs: Set<string>; files: Set<string> }> {
  const run = await captureGit({
    args: ['ls-files', '--ignored', '--exclude-standard', '--others', '--directory', '--no-empty-directory', '-z'],
    cwd,
  })
  if (!run.ok) throw new Error(`Cannot list ignored files of ${cwd}: ${run.stderr.trim()}`)
  const dirs = new Set<string>()
  const files = new Set<string>()
  for (const entry of splitNull(run.stdout)) {
    if (entry.endsWith('/')) dirs.add(entry.slice(0, -1))
    else files.add(entry)
  }
  return { dirs, files }
}

const globToSource = (pattern: string): string => {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    source += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char
  }
  return source
}

const patternToRegExp = (raw: string): RegExp => {
  const anchored = raw.startsWith('/')
  let pattern = anchored ? raw.slice(1) : raw
  if (pattern.endsWith('/')) pattern = `${pattern}**`
  const body = globToSource(pattern)
  return new RegExp(anchored ? `^${body}$` : `^(.*/)?${body}$`)
}

async function cloudIncludePatterns({ cwd }: { cwd: string }): Promise<RegExp[]> {
  const text = await readFile(join(cwd, CLOUD_INCLUDE_PATH), 'utf8').catch(() => null)
  if (text === null) return []
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(patternToRegExp)
}

export type IgnoreFilter = {
  isCaptured: (path: string) => boolean
  isCapturedDir: (path: string) => boolean
}

const ALWAYS_CAPTURED = new Set([CLOUD_INCLUDE_PATH])
const CAPTURE_ALL: IgnoreFilter = { isCaptured: () => true, isCapturedDir: () => true }

export async function resolveIgnoreFilter({ cwd }: { cwd: string }): Promise<IgnoreFilter> {
  const { dirs, files } = await listIgnoredEntries({ cwd })
  const forced = await cloudIncludePatterns({ cwd })
  if (dirs.size === 0 && files.size === 0) return CAPTURE_ALL
  const isForced = (path: string): boolean => forced.some((pattern) => pattern.test(path))
  const holdsAlwaysCaptured = (path: string): boolean =>
    [...ALWAYS_CAPTURED].some((kept) => kept === path || kept.startsWith(`${path}/`))
  const underIgnoredDir = (path: string): boolean => {
    for (let index = path.indexOf('/'); index > 0; index = path.indexOf('/', index + 1)) {
      if (dirs.has(path.slice(0, index))) return true
    }
    return false
  }
  const dirPrunable = (path: string): boolean => {
    if (ALWAYS_CAPTURED.has(path) || isForced(path) || holdsAlwaysCaptured(path) || !dirs.has(path)) return false
    return !forced.some((pattern) => pattern.test(`${path}/`))
  }
  return {
    isCaptured: (path) => ALWAYS_CAPTURED.has(path) || isForced(path) || (!files.has(path) && !underIgnoredDir(path)),
    isCapturedDir: (path) => !dirPrunable(path),
  }
}

export const noIgnoreFilter: IgnoreFilter = CAPTURE_ALL
