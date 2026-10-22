import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { browserSafetyViolations } from './browser-safe-imports'

const SRC = join(import.meta.dir, '..')

const sourceFilesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFilesUnder(path)
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : []
  })

describe('browserSafetyViolations', () => {
  it.each([
    ["import { x } from 'node:fs'", 'node: import'],
    ["import { x } from 'bun'", 'bun import'],
    ["import { test } from 'bun:test'", 'bun import'],
    ['const file = Bun.file(path)', 'Bun global'],
    ['const home = process.env.HOME', 'process global'],
    ["import { x } from '@dltech/atlas-harness'", 'harness import'],
    ["import { x } from '@dltech/atlas-wire'", 'wire root import'],
    ["import { x } from '@vercel/sandbox'", '@vercel/sandbox import'],
    ["import { x } from './sibling.js'", 'relative .js import'],
    ["export * from '../parent.js'", 'relative .js import'],
  ])('flags %s', (source, rule) => {
    expect(browserSafetyViolations(source).map((violation) => violation.rule)).toContain(rule)
  })

  it('accepts the browser-safe imports', () => {
    const source = [
      "import { z } from 'zod'",
      "import { toThreadId } from '@dltech/atlas-core'",
      "import { EServeFrame } from '@dltech/atlas-wire/web'",
      "import { x } from './sibling'",
    ].join('\n')
    expect(browserSafetyViolations(source)).toEqual([])
  })

  it('reports the line of a violation', () => {
    expect(browserSafetyViolations("import { z } from 'zod'\nconst a = process.env")).toEqual([
      { rule: 'process global', line: 2 },
    ])
  })
})

describe('the client package', () => {
  it('imports only browser-safe modules', () => {
    const offences = sourceFilesUnder(SRC).flatMap((file) =>
      browserSafetyViolations(readFileSync(file, 'utf8')).map(
        ({ rule, line }) => `${relative(SRC, file)}:${line} ${rule}`,
      ),
    )
    expect(offences).toEqual([])
  })
})
