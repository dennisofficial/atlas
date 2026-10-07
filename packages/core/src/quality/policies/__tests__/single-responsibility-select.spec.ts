import { describe, expect, it } from 'bun:test'

import { EQualityScopeKind, type QualityScope } from '../../change'
import { scopeFixture } from '../../__tests__/fixtures'
import { singleResponsibilityPolicy } from '../single-responsibility'

type ScopeSpec = { id: string; kind: EQualityScopeKind; parent?: string; changed?: boolean } & Partial<QualityScope>

function scopeOf({ id, kind, parent, changed = true, ...overrides }: ScopeSpec): QualityScope {
  return scopeFixture({
    id,
    kind,
    name: id,
    parentScopeId: parent ?? null,
    before: 'same',
    after: changed ? 'different' : 'same',
    beforeHash: 'h',
    afterHash: changed ? 'h2' : 'h',
    ...overrides,
  })
}

const select = (scopes: readonly QualityScope[]): readonly string[] => singleResponsibilityPolicy.selectScopes({ scopes })

const { Class, Method, Function: Fn, Module } = EQualityScopeKind

describe('single responsibility selectScopes', () => {
  it('selects the outermost changed class and suppresses everything inside it', () => {
    const scopes = [
      scopeOf({ id: 'mod', kind: Module }),
      scopeOf({ id: 'outer', kind: Class, parent: 'mod' }),
      scopeOf({ id: 'inner', kind: Class, parent: 'outer' }),
      scopeOf({ id: 'run', kind: Method, parent: 'outer' }),
      scopeOf({ id: 'helper', kind: Fn, parent: 'run' }),
    ]
    expect(select(scopes)).toEqual(['outer'])
  })

  it('selects the nearest named function per changed range outside classes', () => {
    const scopes = [
      scopeOf({ id: 'outerFn', kind: Fn }),
      scopeOf({ id: 'innerFn', kind: Fn, parent: 'outerFn' }),
      scopeOf({ id: 'loneFn', kind: Fn }),
    ]
    expect(select(scopes)).toEqual(['innerFn', 'loneFn'])
  })

  it('selects the outer function when only it changed', () => {
    const scopes = [scopeOf({ id: 'outerFn', kind: Fn }), scopeOf({ id: 'innerFn', kind: Fn, parent: 'outerFn', changed: false })]
    expect(select(scopes)).toEqual(['outerFn'])
  })

  it('selects functions under an unchanged class', () => {
    const scopes = [scopeOf({ id: 'C', kind: Class, changed: false }), scopeOf({ id: 'fn', kind: Fn, parent: 'C' })]
    expect(select(scopes)).toEqual(['fn'])
  })

  it('never selects a changed method, even under an unchanged class or with no parent', () => {
    const scopes = [
      scopeOf({ id: 'C', kind: Class, changed: false }),
      scopeOf({ id: 'm1', kind: Method, parent: 'C' }),
      scopeOf({ id: 'm2', kind: Method }),
    ]
    expect(select(scopes)).toEqual([])
  })

  it('never selects a module', () => {
    expect(select([scopeOf({ id: 'mod', kind: Module })])).toEqual([])
  })

  it('selects a class nested in a function instead of the enclosing function', () => {
    const scopes = [scopeOf({ id: 'fn', kind: Fn }), scopeOf({ id: 'K', kind: Class, parent: 'fn' })]
    expect(select(scopes)).toEqual(['K'])
  })

  it('treats a changed hash with identical text as changed, and identical text and hashes as unchanged', () => {
    const hashOnly = scopeOf({ id: 'a', kind: Fn, changed: false, afterHash: 'other' })
    const untouched = scopeOf({ id: 'b', kind: Fn, changed: false })
    expect(select([hashOnly, untouched])).toEqual(['a'])
  })

  it('selects a created scope and skips a deleted scope', () => {
    const created = scopeOf({ id: 'created', kind: Class, before: null, beforeHash: null })
    const deleted = scopeOf({ id: 'deleted', kind: Class, after: null, afterHash: null })
    expect(select([created, deleted])).toEqual(['created'])
  })

  it('skips unnamed functions', () => {
    expect(select([scopeOf({ id: 'anon', kind: Fn, name: '  ' })])).toEqual([])
  })

  it('returns ids in sorted order regardless of input order', () => {
    const scopes = [scopeOf({ id: 'zeta', kind: Fn }), scopeOf({ id: 'alpha', kind: Class }), scopeOf({ id: 'mid', kind: Fn })]
    expect(select(scopes)).toEqual(['alpha', 'mid', 'zeta'])
    expect(select([...scopes].reverse())).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('treats an unknown parent as a root and survives a parent cycle', () => {
    const orphan = scopeOf({ id: 'orphan', kind: Fn, parent: 'missing' })
    const left = scopeOf({ id: 'left', kind: Fn, parent: 'right' })
    const right = scopeOf({ id: 'right', kind: Fn, parent: 'left' })
    expect(select([orphan])).toEqual(['orphan'])
    expect(() => select([left, right])).not.toThrow()
  })

  it('returns only ids that were supplied', () => {
    const scopes = [scopeOf({ id: 'C', kind: Class }), scopeOf({ id: 'fn', kind: Fn })]
    const supplied = new Set(scopes.map((scope) => scope.id))
    expect(select(scopes).every((id) => supplied.has(id))).toBe(true)
  })
})
