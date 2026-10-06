import { EQualityLanguage, EQualityScopeKind } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { parseQualitySource, scriptKindForPath } from '../typescript-parser'

const parse = (path: string, text: string) => {
  const result = parseQualitySource({ path, text })
  if (!result.ok) throw new Error(`expected parse success for ${path}`)
  return result.source
}

describe('scriptKindForPath', () => {
  it('maps supported extensions', () => {
    for (const extension of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']) {
      expect(scriptKindForPath({ path: `/p/a${extension}` })).not.toBeNull()
    }
  })

  it('rejects declaration files and unknown extensions', () => {
    expect(scriptKindForPath({ path: '/p/a.d.ts' })).toBeNull()
    expect(scriptKindForPath({ path: '/p/a.d.mts' })).toBeNull()
    expect(scriptKindForPath({ path: '/p/a.d.cts' })).toBeNull()
    expect(scriptKindForPath({ path: '/p/a.py' })).toBeNull()
    expect(scriptKindForPath({ path: '/p/a.css' })).toBeNull()
  })
})

describe('parseQualitySource', () => {
  it('collects named functions, classes and methods', () => {
    const source = parse('/p/a.ts', [
      'export function helper() { return 1 }',
      'export class Greeter {',
      '  greet() { return helper() }',
      '  get name() { return "g" }',
      '}',
    ].join('\n'))
    const qualified = source.declarations.map((declaration) => `${declaration.kind}:${declaration.qualifiedName}`)
    expect(qualified).toEqual([
      'function:helper',
      'class:Greeter',
      'method:Greeter.greet',
      'method:Greeter.name',
    ])
    const method = source.declarations.find((declaration) => declaration.qualifiedName === 'Greeter.greet')
    expect(method?.parentQualifiedName).toBe('Greeter')
  })

  it('collects named arrow functions and nested functions', () => {
    const source = parse('/p/a.ts', [
      'export const outer = () => {',
      '  const inner = () => 1',
      '  return inner()',
      '}',
      'function nested() { function deep() { return 2 } return deep() }',
    ].join('\n'))
    const qualified = source.declarations.map((declaration) => declaration.qualifiedName)
    expect(qualified).toEqual(['outer', 'outer.inner', 'nested', 'nested.deep'])
    const inner = source.declarations.find((declaration) => declaration.qualifiedName === 'outer.inner')
    expect(inner?.kind).toBe(EQualityScopeKind.Function)
    expect(inner?.parentQualifiedName).toBe('outer')
  })

  it('parses TSX and JSX without syntax errors', () => {
    const tsx = parse('/p/view.tsx', 'export const View = () => <div className="a">{1}</div>\n')
    expect(tsx.declarations.map((declaration) => declaration.qualifiedName)).toEqual(['View'])
    const jsx = parse('/p/view.jsx', 'export const View = () => <span>hi</span>\n')
    expect(jsx.language).toBe(EQualityLanguage.JavaScript)
  })

  it('reports invalid syntax without throwing', () => {
    const result = parseQualitySource({ path: '/p/broken.ts', text: 'function broken( {' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.invalidSyntax).toBe(true)
  })

  it('returns unsupported for unknown extensions', () => {
    const result = parseQualitySource({ path: '/p/a.py', text: 'def f(): pass' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.invalidSyntax).toBe(false)
  })

  it('skips anonymous default exports and computed names', () => {
    const source = parse('/p/a.ts', 'export default function () { return 1 }\nexport const x = 1\n')
    expect(source.declarations).toHaveLength(0)
  })

  it('derives 1-based line ranges', () => {
    const source = parse('/p/a.ts', 'const a = 1\n\nfunction target() {\n  return a\n}\n')
    const target = source.declarations.find((declaration) => declaration.qualifiedName === 'target')
    expect(target?.lineRange).toEqual({ start: 3, end: 5 })
  })

  it('collects import statements and top-level evidence labels', () => {
    const source = parse('/p/a.ts', [
      "import { z } from 'zod'",
      "import path from 'node:path'",
      'export const answer = 42',
      'function useAnswer() { return answer }',
    ].join('\n'))
    expect(source.importStatements).toEqual(["import { z } from 'zod'", "import path from 'node:path'"])
    expect(source.evidenceLabels).toEqual(['answer', 'useAnswer'])
  })

  it('structural hash is stable across whitespace changes and renames, not body changes', () => {
    const first = parse('/p/a.ts', 'function greet() { return 1 }')
    const spaced = parse('/p/a.ts', 'function greet() {\n    return 1\n}')
    const renamed = parse('/p/a.ts', 'function salute() { return 1 }')
    const changed = parse('/p/a.ts', 'function greet() { return 2 }')
    const greetFirst = first.declarations[0]
    const greetSpaced = spaced.declarations[0]
    const salute = renamed.declarations[0]
    const altered = changed.declarations[0]
    if (greetFirst === undefined || greetSpaced === undefined || salute === undefined || altered === undefined) {
      throw new Error('expected declarations')
    }
    expect(greetFirst.structuralHash).toBe(greetSpaced.structuralHash)
    expect(greetFirst.structuralHash).toBe(salute.structuralHash)
    expect(greetFirst.structuralHash).not.toBe(altered.structuralHash)
  })
})
