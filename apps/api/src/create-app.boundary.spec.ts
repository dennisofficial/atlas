import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'

const SRC_ROOT = import.meta.dirname
const ENTRY = path.join(SRC_ROOT, 'create-app.ts')
const AUTH_SERVER = path.join(SRC_ROOT, 'api', 'platform', 'auth', 'auth.server.ts')
// Only static (`from`) imports are followed. `import()` is deferred and runs after
// vercel.ts's injectEncryptedTierEnv(), so it is the sanctioned way to reach code that
// reads process.env at module load.
const SPECIFIER_PATTERN = /(?:from\s+)['"]([^'"]+)['"]/g

function specifiersOf({ file }: { file: string }): string[] {
  return [...readFileSync(file, 'utf8').matchAll(SPECIFIER_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )
}

function resolveLocal({ file, specifier }: { file: string; specifier: string }): string | null {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(file), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts')]) {
    if (candidate.endsWith('.js') && !candidate.endsWith('.ts')) {
      const asTs = candidate.slice(0, -3) + '.ts'
      if (exists(asTs)) return asTs
      continue
    }
    if (exists(candidate)) return candidate
  }
  return null
}

function exists(file: string): boolean {
  try {
    return readdirSync(path.dirname(file)).includes(path.basename(file))
  } catch {
    return false
  }
}

function reachableFrom({ entry }: { entry: string }): Set<string> {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length > 0) {
    const file = stack.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    for (const specifier of specifiersOf({ file })) {
      const resolved = resolveLocal({ file, specifier })
      if (resolved !== null && !seen.has(resolved)) stack.push(resolved)
    }
  }
  return seen
}

describe('create-app import boundary', () => {
  it('never statically reaches auth.server.ts, whose top-level env throw runs before injectEncryptedTierEnv', () => {
    const reachable = reachableFrom({ entry: ENTRY })
    const offenders = [...reachable]
      .filter((file) => file === AUTH_SERVER)
      .map((file) => path.relative(SRC_ROOT, file))
    expect(
      offenders,
      'create-app must not statically import auth.server: it throws on env at module load, before vercel.ts decrypts the tier',
    ).toEqual([])
  })
})
