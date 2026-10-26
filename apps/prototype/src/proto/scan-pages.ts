import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKIPPED_ROOT_DIRS = new Set(['api', 'proto'])
const REDIRECT_CALL = /\b(permanentRedirect|redirect)\(/
const RENDERED_JSX = /(return|=>)\s*\(?\s*<[A-Za-z>]/

export function isRedirectOnly(source: string): boolean {
  return REDIRECT_CALL.test(source) && !RENDERED_JSX.test(source)
}

function isRoutableDir(name: string): boolean {
  return !name.startsWith('_') && !name.startsWith('@') && !name.startsWith('.')
}

function hasVisiblePage(dir: string): boolean {
  const file = join(dir, 'page.tsx')
  return existsSync(file) && !isRedirectOnly(readFileSync(file, 'utf8'))
}

function walk({ dir, segments }: { dir: string; segments: string[] }): string[][] {
  const here = hasVisiblePage(dir) ? [segments] : []
  const subdirs = readdirSync(dir, { withFileTypes: true }).filter(
    (entry) =>
      entry.isDirectory() &&
      isRoutableDir(entry.name) &&
      !(segments.length === 0 && SKIPPED_ROOT_DIRS.has(entry.name)),
  )
  const nested = subdirs.flatMap((entry) =>
    walk({ dir: join(dir, entry.name), segments: [...segments, entry.name] }),
  )
  return [...here, ...nested]
}

export function scanPageDirs(appRoot: string): string[][] {
  return walk({ dir: appRoot, segments: [] })
}
