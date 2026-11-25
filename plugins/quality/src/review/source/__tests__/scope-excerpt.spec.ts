import { describe, expect, it } from 'bun:test'

import type { QualityScope } from '@dltech/atlas-core'

import { prepareQualityScopes } from '../index'
import { excerptOf, MAX_EXCERPT_LINES } from '../scope-excerpt'

const PROJECT = '/repo'
const PATH = `${PROJECT}/src/service.ts`

function classText(args: { marker: string; everywhere?: boolean }): string {
  const rows = Array.from({ length: 400 }, (_, index) =>
    index === 200 || args.everywhere === true
      ? `    this.total += this.load(${index}) // ${args.marker}`
      : `    this.total += this.load(${index})`,
  )
  return [
    'export class Ledger {',
    '  private total = 0',
    '',
    '  reconcile(): number {',
    '    this.total = 0',
    ...rows,
    '    return this.total',
    '  }',
    '',
    '  load(seed: number): number {',
    '    return seed * 2',
    '  }',
    '',
    '  audit(): void {',
    '    this.reconcile()',
    '  }',
    '}',
    '',
  ].join('\n')
}

function scopeOf(args: { before: string; after: string }): QualityScope {
  const preparation = prepareQualityScopes({
    change: { path: PATH, before: args.before, after: args.after },
    projectDirectory: PROJECT,
    workspaceNamespace: 'ns',
    previousScopes: [],
  })
  const scope = preparation.scopes.find((candidate) => candidate.name === 'Ledger')
  if (scope === undefined) throw new Error('expected the Ledger class scope')
  return scope
}

describe('scope excerpt', () => {
  it('keeps the changed line and its context, and drops the rest', () => {
    const before = classText({ marker: 'old' })
    const after = classText({ marker: 'new' })
    const scope = scopeOf({ before, after })
    const { scope: excerpted, excerpt } = excerptOf({ scope })

    expect(excerpted.id).toBe(scope.id)
    expect(excerpted.after).toContain('// new')
    expect(excerpted.after).not.toContain('// old')
    expect(excerpted.after?.split('\n').length).toBeLessThan(
      (scope.after ?? '').split('\n').length / 4,
    )
    expect(excerpt.beforeOmittedLines).toBeGreaterThan(0)
    expect(excerpt.afterOmittedLines).toBeGreaterThan(0)
    expect(excerpted.diff.length).toBeLessThan(scope.diff.length)
  })

  it('names every member of the class in the outline', () => {
    const scope = scopeOf({
      before: classText({ marker: 'old' }),
      after: classText({ marker: 'new' }),
    })
    const { excerpt } = excerptOf({ scope })

    expect(excerpt.outline).toContain('method Ledger.reconcile lines 4-407')
    expect(excerpt.outline).toContain('method Ledger.load lines 409-411')
    expect(excerpt.outline).toContain('method Ledger.audit lines 413-415')
    expect(excerpt.outline).toContain('field total')
  })

  it('caps a wholly rewritten class and says how much it dropped', () => {
    const before = classText({ marker: 'old' })
    const after = classText({ marker: 'new', everywhere: true })
    const scope = scopeOf({ before, after })
    const { scope: excerpted, excerpt } = excerptOf({ scope })

    expect(excerpted.after?.split('\n').length).toBeLessThanOrEqual(MAX_EXCERPT_LINES + 1)
    expect(excerpted.after).toContain('lines omitted')
    expect(excerpt.afterOmittedLines).toBeGreaterThan(0)
  })

  it('excerpts a created scope with no before text', () => {
    const after = classText({ marker: 'new' })
    const preparation = prepareQualityScopes({
      change: { path: PATH, before: null, after },
      projectDirectory: PROJECT,
      workspaceNamespace: 'ns',
      previousScopes: [],
    })
    const scope = preparation.scopes.find((candidate) => candidate.name === 'Ledger')
    if (scope === undefined) throw new Error('expected the Ledger class scope')

    const { scope: excerpted, excerpt } = excerptOf({ scope })

    expect(excerpted.before).toBeNull()
    expect(excerpt.beforeOmittedLines).toBe(0)
    expect(excerpt.afterStartLine).toBe(1)
  })
})
