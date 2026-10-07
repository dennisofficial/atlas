import {
  EQualityScopeKind,
  EQualitySkipReason,
  type CapturedFileChange,
  type QualityScope,
  type QualityScopeIdentity,
} from '@dltech/atlas-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { prepareQualityScopes } from '../scope-adapter'

const PROJECT = '/proj'
const NAMESPACE = 'local:test-root-sha'
let scratch = ''
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'atlas-quality-adapter-'))
})
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true })
})

function prepare(args: {
  path: string
  before: string | null
  after: string
  previousScopes?: readonly QualityScopeIdentity[]
}) {
  const change: CapturedFileChange = { path: args.path, before: args.before, after: args.after }
  return prepareQualityScopes({
    change,
    projectDirectory: PROJECT,
    workspaceNamespace: NAMESPACE,
    previousScopes: args.previousScopes ?? [],
  })
}

const byKind = (scopes: readonly QualityScope[], kind: EQualityScopeKind) =>
  scopes.filter((scope) => scope.kind === kind)

describe('prepareQualityScopes gating', () => {
  it('skips declaration files', () => {
    const result = prepare({ path: `${PROJECT}/a.d.ts`, before: null, after: 'declare const a: number\n' })
    expect(result.scopes).toHaveLength(0)
    expect(result.skipped[0]?.reason).toBe(EQualitySkipReason.DeclarationOnly)
  })

  it('skips unsupported languages', () => {
    const result = prepare({ path: `${PROJECT}/a.py`, before: null, after: 'def f(): pass\n' })
    expect(result.skipped[0]?.reason).toBe(EQualitySkipReason.UnsupportedLanguage)
  })

  it('skips paths outside the project directory', () => {
    const result = prepare({ path: '/elsewhere/a.ts', before: null, after: 'const a = 1\n' })
    expect(result.skipped[0]?.reason).toBe(EQualitySkipReason.OutsideWorkspace)
  })

  it('skips oversized sources', () => {
    const result = prepare({ path: `${PROJECT}/a.ts`, before: null, after: 'x'.repeat(1024 * 1024 + 1) })
    expect(result.skipped[0]?.reason).toBe(EQualitySkipReason.OversizedSource)
  })

  it('skips invalid syntax with InvalidSyntax', () => {
    const result = prepare({ path: `${PROJECT}/broken.ts`, before: null, after: 'function broken( {' })
    expect(result.scopes).toHaveLength(0)
    expect(result.skipped[0]?.reason).toBe(EQualitySkipReason.InvalidSyntax)
  })

  it('emits no scopes for an unchanged file', () => {
    const result = prepare({ path: `${PROJECT}/a.ts`, before: 'const a = 1\n', after: 'const a = 1\n' })
    expect(result.scopes).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })
})

describe('prepareQualityScopes scopes', () => {
  it('emits module plus every changed enclosing scope for creation', () => {
    const after = [
      "import { z } from 'zod'",
      'export function helper() { return 1 }',
      'export class Greeter {',
      '  greet() { return helper() }',
      '}',
      '',
    ].join('\n')
    const result = prepare({ path: `${PROJECT}/src/a.ts`, before: null, after })

    expect(result.skipped).toHaveLength(0)
    const module = result.scopes.find((scope) => scope.kind === EQualityScopeKind.Module)
    expect(module?.before).toBeNull()
    expect(module?.after).toBe(after)
    expect(module?.path).toBe('src/a.ts')
    expect(module?.dependencyContext).toEqual(["import { z } from 'zod'"])

    const helper = result.scopes.find((scope) => scope.name === 'helper')
    expect(helper?.kind).toBe(EQualityScopeKind.Function)
    expect(helper?.before).toBeNull()
    expect(helper?.after).toBe('export function helper() { return 1 }')
    expect(helper?.parentScopeId).toBe(module?.id)

    const greeter = result.scopes.find((scope) => scope.name === 'Greeter')
    const greet = result.scopes.find((scope) => scope.name === 'greet')
    expect(greeter?.kind).toBe(EQualityScopeKind.Class)
    expect(greet?.kind).toBe(EQualityScopeKind.Method)
    expect(greet?.parentScopeId).toBe(greeter?.id)
    expect(greeter?.parentScopeId).toBe(module?.id)
  })

  it('emits only the changed function, not its untouched sibling', () => {
    const before = 'function a() { return 1 }\nfunction b() { return 2 }\n'
    const after = 'function a() { return 1 }\nfunction b() { return 3 }\n'
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after })

    const functions = byKind(result.scopes, EQualityScopeKind.Function)
    expect(functions.map((scope) => scope.name)).toEqual(['b'])
    const changed = functions[0]
    expect(changed?.before).toBe('function b() { return 2 }')
    expect(changed?.after).toBe('function b() { return 3 }')
    expect(changed?.diff).toContain('-function b() { return 2 }')
    expect(changed?.diff).toContain('+function b() { return 3 }')
  })

  it('keeps IDs stable across a line shift plus body change', () => {
    const before = 'function target() { return 1 }\n'
    const after = '\n\n\nfunction target() { return 2 }\n'
    const first = prepare({ path: `${PROJECT}/a.ts`, before: null, after: before })
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after, previousScopes: first.scopes })

    const firstTarget = first.scopes.find((scope) => scope.name === 'target')
    const target = result.scopes.find((scope) => scope.name === 'target')
    expect(target?.id).toBe(firstTarget?.id)
    expect(target?.before).toBe('function target() { return 1 }')
    expect(target?.after).toBe('function target() { return 2 }')
    expect(target?.lineRange?.start).toBe(4)

    const shiftedAgain = prepare({ path: `${PROJECT}/a.ts`, before: after, after: `\n${after}` })
    const shiftedTarget = shiftedAgain.scopes.find((scope) => scope.name === 'target')
    expect(shiftedTarget).toBeUndefined()
  })

  it('carries identity through a unique rename by structural fingerprint', () => {
    const before = 'function greet() { return 1 }\n'
    const renamed = 'function salute() { return 1 }\n'
    const first = prepare({ path: `${PROJECT}/a.ts`, before: null, after: before })
    const second = prepare({ path: `${PROJECT}/a.ts`, before, after: renamed, previousScopes: first.scopes })

    const salute = second.scopes.find((scope) => scope.name === 'salute')
    const greet = first.scopes.find((scope) => scope.name === 'greet')
    expect(salute?.before).toBe('function greet() { return 1 }')
    expect(salute?.after).toBe('function salute() { return 1 }')
    expect(salute?.id).toBe(greet?.id)
  })

  it('emits identity-uncertain diagnostics on an ambiguous rename', () => {
    const before = 'function a() { return 1 }\nfunction b() { return 1 }\n'
    const after = 'function c() { return 1 }\nfunction d() { return 1 }\n'
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after })

    const uncertain = result.skipped.filter(
      (diagnostic) => diagnostic.reason === EQualitySkipReason.ScopeIdentityUncertain,
    )
    expect(uncertain.length).toBeGreaterThan(0)
    const functions = byKind(result.scopes, EQualityScopeKind.Function)
    expect(functions).toHaveLength(0)
  })

  it('marks deleted scopes with after:null and created with before:null', () => {
    const before = 'function keep() { return 1 }\nfunction gone() { return 2 }\n'
    const after = 'function keep() { return 1 }\nfunction fresh() { return 3 }\n'
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after })

    const deleted = result.scopes.find((scope) => scope.name === 'gone')
    expect(deleted?.after).toBeNull()
    expect(deleted?.before).toBe('function gone() { return 2 }')
    const created = result.scopes.find((scope) => scope.name === 'fresh')
    expect(created?.before).toBeNull()
    expect(created?.after).toBe('function fresh() { return 3 }')
  })

  it('emits a module scope for import-only edits so the engine decides coverage', () => {
    const before = "import { a } from 'a'\nexport const x = 1\n"
    const after = "import { a } from 'a'\nimport { b } from 'b'\nexport const x = 1\n"
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after })

    expect(result.scopes.map((scope) => scope.kind)).toEqual([EQualityScopeKind.Module])
    expect(result.scopes[0]?.dependencyContext).toEqual(["import { a } from 'a'", "import { b } from 'b'"])
  })

  it('never reads the current disk: captured strings are the whole input', async () => {
    const path = `${scratch}/ghost.ts`
    const after = 'export function fromMemory() { return 1 }\n'
    const result = prepareQualityScopes({
      change: { path, before: null, after },
      projectDirectory: scratch,
      workspaceNamespace: NAMESPACE,
      previousScopes: [],
    })
    expect(result.scopes.length).toBeGreaterThan(0)
    const fromMemory = result.scopes.find((scope) => scope.name === 'fromMemory')
    expect(fromMemory?.after).toBe('export function fromMemory() { return 1 }')
  })

  it('preserves exact CRLF and unicode in scope text and diff context', () => {
    const before = 'function a() { return 1 }\r\nfunction b() { return "é" }\r\n'
    const after = 'function a() { return 1 }\r\nfunction b() { return "ü" }\r\n'
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after })
    const changed = result.scopes.find((scope) => scope.name === 'b')
    expect(changed?.after).toBe('function b() { return "ü" }')
    expect(changed?.before).toBe('function b() { return "é" }')
  })

  it('matches an edited overload signature without delete/create splitting', () => {
    const before = 'function f(x: string): void\nfunction f(x: number): void\nfunction f(x: unknown) { return }\n'
    const after = 'function f(x: string): void\nfunction f(x: number): void\nfunction f(x: unknown) { throw new Error() }\n'
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after })

    const functions = byKind(result.scopes, EQualityScopeKind.Function)
    expect(functions).toHaveLength(1)
    expect(functions[0]?.before).not.toBeNull()
    expect(functions[0]?.after).not.toBeNull()
    expect(result.skipped).toHaveLength(0)
  })

  it('distinguishes getter and setter with the same name', () => {
    const before = 'class A {\n  get x() { return 1 }\n  set x(value: number) { return }\n}\n'
    const after = 'class A {\n  get x() { return 2 }\n  set x(value: number) { return }\n}\n'
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after })

    const methods = byKind(result.scopes, EQualityScopeKind.Method)
    expect(methods).toHaveLength(1)
    expect(methods[0]?.after).toContain('return 2')
    expect(result.skipped).toHaveLength(0)
  })

  it('never matches a function against a method with the same body', () => {
    const before = 'function a() {}\n'
    const after = 'class K {\n  n() {}\n}\n'
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after })

    const deleted = result.scopes.find((scope) => scope.name === 'a')
    expect(deleted?.kind).toBe(EQualityScopeKind.Function)
    expect(deleted?.after).toBeNull()
    const createdClass = result.scopes.find((scope) => scope.name === 'K')
    expect(createdClass?.kind).toBe(EQualityScopeKind.Class)
    expect(createdClass?.before).toBeNull()
  })

  it('keeps method identity through a rename when previous scopes are supplied', () => {
    const before = 'class G {\n  greet() { return 1 }\n}\n'
    const renamed = 'class G {\n  salute() { return 1 }\n}\n'
    const first = prepare({ path: `${PROJECT}/a.ts`, before: null, after: before })
    const second = prepare({ path: `${PROJECT}/a.ts`, before, after: renamed, previousScopes: first.scopes })

    const greet = first.scopes.find((scope) => scope.name === 'greet')
    const salute = second.scopes.find((scope) => scope.name === 'salute')
    expect(salute?.id).toBe(greet?.id)
    expect(salute?.before).toContain('greet()')
    expect(salute?.after).toContain('salute()')
  })

  it('keeps arrow-function identity through a rename by structural fingerprint', () => {
    const before = 'export const greet = () => 1\n'
    const renamed = 'export const salute = () => 1\n'
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after: renamed })

    expect(result.skipped).toHaveLength(0)
    const salute = result.scopes.find((scope) => scope.name === 'salute')
    expect(salute?.before).toBe('export const greet = () => 1')
    expect(salute?.after).toBe('export const salute = () => 1')
  })

  it('emits one diagnostic per ambiguous group and no guessed scopes', () => {
    const before = 'function a() { return 1 }\nfunction b() { return 1 }\n'
    const after = 'function c() { return 1 }\nfunction d() { return 1 }\n'
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after })

    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toBe(EQualitySkipReason.ScopeIdentityUncertain)
    expect(byKind(result.scopes, EQualityScopeKind.Function)).toHaveLength(0)
  })

  it('points nested scopes at the real parent id even when the parent changed', () => {
    const before = 'function f() {\n  function inner() { return 1 }\n  return inner()\n}\n'
    const after = 'function f() {\n  function inner() { return 2 }\n  return inner()\n}\n'
    const result = prepare({ path: `${PROJECT}/a.ts`, before, after })

    const parent = result.scopes.find((scope) => scope.name === 'f')
    const inner = result.scopes.find((scope) => scope.name === 'inner')
    expect(parent).toBeDefined()
    expect(inner?.parentScopeId).toBe(parent?.id)
  })

  it('accepts filenames that start with two dots inside the project', () => {
    const result = prepare({ path: `${PROJECT}/..config.ts`, before: null, after: 'const a = 1\n' })
    expect(result.skipped).toHaveLength(0)
    expect(result.scopes.length).toBeGreaterThan(0)
  })
})
