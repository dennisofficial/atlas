import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const SOURCE_ROOTS = ['packages', 'apps']
const SKIPPED_DIRECTORIES = new Set(['node_modules', '__tests__', 'migrations', 'dist', 'build'])
const SOURCE_FILE = /\.tsx?$/

const ONE_TIME_BACKFILL = join(REPO_ROOT, 'apps', 'api', 'scripts', 'backfill-event-pictures')

const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  { pattern: /\bEvent\s*\.\s*update\s*\(/, what: 'Event.update(' },
  { pattern: /\bEvent\s*\.\s*updateAndCount\s*\(/, what: 'Event.updateAndCount(' },
  { pattern: /\bEvent\s*\.\s*upsert\s*\(/, what: 'Event.upsert(' },
  { pattern: /\bEvent\s*\.\s*delete\s*\(/, what: 'Event.delete(' },
  { pattern: /\bEvent\s*\.\s*deleteAndCount\s*\(/, what: 'Event.deleteAndCount(' },
  { pattern: /UPDATE\s+"public"\."Event"/i, what: 'raw SQL UPDATE "public"."Event"' },
  { pattern: /DELETE\s+FROM\s+"public"\."Event"/i, what: 'raw SQL DELETE FROM "public"."Event"' },
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

describe('the Event log is append-only', () => {
  it('has no source outside __tests__ that updates, upserts or deletes event rows', () => {
    const offences: string[] = []
    for (const root of SOURCE_ROOTS) {
      for (const file of sourceFiles(join(REPO_ROOT, root))) {
        if (file.startsWith(ONE_TIME_BACKFILL)) continue
        const text = readFileSync(file, 'utf8')
        for (const { pattern, what } of FORBIDDEN) {
          if (pattern.test(text)) offences.push(`${file}: ${what}`)
        }
      }
    }
    expect(offences).toEqual([])
  })
})
