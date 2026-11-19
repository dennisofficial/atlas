import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const SOURCE_ROOTS = ['packages', 'apps']
const SKIPPED_DIRECTORIES = new Set(['node_modules', '__tests__', 'migrations', 'dist', 'build'])
const SOURCE_FILE = /\.tsx?$/

const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  { pattern: /\bV2Event\s*\.\s*update\s*\(/, what: 'V2Event.update(' },
  { pattern: /\bV2Event\s*\.\s*updateAndCount\s*\(/, what: 'V2Event.updateAndCount(' },
  { pattern: /\bV2Event\s*\.\s*upsert\s*\(/, what: 'V2Event.upsert(' },
  { pattern: /\bV2Event\s*\.\s*delete\s*\(/, what: 'V2Event.delete(' },
  { pattern: /\bV2Event\s*\.\s*deleteAndCount\s*\(/, what: 'V2Event.deleteAndCount(' },
  { pattern: /UPDATE\s+"v2"\."V2Event"/i, what: 'raw SQL UPDATE "v2"."V2Event"' },
  { pattern: /DELETE\s+FROM\s+"v2"\."V2Event"/i, what: 'raw SQL DELETE FROM "v2"."V2Event"' },
]

function sourceFiles(directory: string): string[] {
  const found: string[] = []
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(path))
    else if (SOURCE_FILE.test(entry.name)) found.push(path)
  }
  return found
}

describe('the V2Event log is append-only', () => {
  it('has no source outside __tests__ that updates, upserts or deletes event rows', () => {
    const offences: string[] = []
    for (const root of SOURCE_ROOTS) {
      for (const file of sourceFiles(join(REPO_ROOT, root))) {
        const text = readFileSync(file, 'utf8')
        for (const { pattern, what } of FORBIDDEN) {
          if (pattern.test(text)) offences.push(`${file}: ${what}`)
        }
      }
    }
    expect(offences).toEqual([])
  })
})
