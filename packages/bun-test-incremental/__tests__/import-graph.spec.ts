import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { traceImports } from '../src/import-graph'

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function makeDir(files: Record<string, string>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'import-graph-')))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

describe('traceImports', () => {
  test('follows static, dynamic and required local imports', () => {
    const root = makeDir({
      'main.ts': "import './a'\nawait import('./b')\nrequire('./c')",
      'a.ts': 'export const a = 1',
      'b.ts': 'export const b = 1',
      'c.ts': 'export const c = 1',
    })
    const traced = traceImports({ entry: join(root, 'main.ts'), repoRoot: root })
    expect(traced.failure).toBeUndefined()
    expect(traced.files.sort()).toEqual(['a', 'b', 'c', 'main'].map((n) => join(root, `${n}.ts`)))
  })

  test('a file that fails to parse is reported by name', () => {
    const root = makeDir({
      'main.ts': "import './broken'",
      'broken.ts': 'const = ;',
    })
    const traced = traceImports({ entry: join(root, 'main.ts'), repoRoot: root })
    expect(traced.failure).toBe('could not trace imports of broken.ts')
  })
})
