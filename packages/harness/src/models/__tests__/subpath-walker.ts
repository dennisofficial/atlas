import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export type SubpathViolation = { file: string; reason: string }

const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm

const RUNTIME_GLOBALS: { reason: string; pattern: RegExp }[] = [
  { reason: 'uses Bun.', pattern: /\bBun\./ },
  { reason: 'uses process.', pattern: /\bprocess\./ },
]

const packageName = (specifier: string): string => {
  const [first, second] = specifier.split('/')
  return first?.startsWith('@') ? `${first}/${second ?? ''}` : (first ?? specifier)
}

const resolveRelative = (args: { from: string; specifier: string }): string | undefined =>
  [
    `${resolve(dirname(args.from), args.specifier)}.ts`,
    join(resolve(dirname(args.from), args.specifier), 'index.ts'),
  ].find(existsSync)

export function subpathViolations(args: {
  entry: string
  allowedPackages: readonly string[]
}): SubpathViolation[] {
  const root = dirname(args.entry)
  const seen = new Set<string>()
  const violations: SubpathViolation[] = []
  const pending = [args.entry]

  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    const report = (reason: string) => violations.push({ file: relative(root, file), reason })

    for (const { reason, pattern } of RUNTIME_GLOBALS) if (pattern.test(text)) report(reason)

    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1]
      if (specifier === undefined) continue
      if (specifier.startsWith('.')) {
        const target = resolveRelative({ from: file, specifier })
        if (target === undefined || !target.startsWith(root + sep)) {
          report(`imports outside src/models: ${specifier}`)
          continue
        }
        pending.push(target)
        continue
      }
      if (specifier.startsWith('node:')) report(`imports ${specifier}`)
      else if (!args.allowedPackages.includes(packageName(specifier)))
        report(`imports ${specifier}`)
    }
  }
  return violations
}
