import { EQualityScopeKind, EQualitySkipReason } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { PROJECT, byKind, prepare } from './adapter-fixtures'

describe('prepareQualityScopes identity', () => {
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
    const second = prepare({
      path: `${PROJECT}/a.ts`,
      before,
      after: renamed,
      previousScopes: first.scopes,
    })

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

  it('keeps method identity through a rename when previous scopes are supplied', () => {
    const before = 'class G {\n  greet() { return 1 }\n}\n'
    const renamed = 'class G {\n  salute() { return 1 }\n}\n'
    const first = prepare({ path: `${PROJECT}/a.ts`, before: null, after: before })
    const second = prepare({
      path: `${PROJECT}/a.ts`,
      before,
      after: renamed,
      previousScopes: first.scopes,
    })

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
})
