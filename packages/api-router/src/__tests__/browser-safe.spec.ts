import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { browserSafetyViolations } from './browser-safe-imports'

const SRC = join(import.meta.dir, '..')
const SKIPPED_DIRECTORIES = new Set(['__tests__', 'generated'])

const sourceFilesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return SKIPPED_DIRECTORIES.has(name) ? [] : sourceFilesUnder(path)
    }
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : []
  })

describe('the api-router package', () => {
  it('ships client source to scan', () => {
    expect(sourceFilesUnder(SRC).map((file) => relative(SRC, file))).toContain('client.ts')
  })

  it('imports only browser-safe modules outside the generated router', () => {
    const offences = sourceFilesUnder(SRC).flatMap((file) =>
      browserSafetyViolations(readFileSync(file, 'utf8')).map(
        ({ rule, line }) => `${relative(SRC, file)}:${line} ${rule}`,
      ),
    )
    expect(offences).toEqual([])
  })
})
