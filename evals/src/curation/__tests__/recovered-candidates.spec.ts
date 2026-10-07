import { describe, expect, test } from 'bun:test'
import { EQualityScopeKind } from '@dltech/atlas-core'

import { ECandidateMethod } from '../candidates'
import { curateRecoveredChange } from '../recovered-candidates'

const source = {
  session: 'private-session',
  repository: 'atlas-public',
  sourceHash: 'a'.repeat(64),
  projectDirectory: '/project',
  change: { path: '/project/example.ts', before: null, after: 'export class Counter { value = 0; increment() { this.value += 1 } }\n' },
}

describe('curateRecoveredChange', () => {
  test('uses production selection and identifies a recovered class without inventing a capture', () => {
    const result = curateRecoveredChange(source)
    expect(result.rejections).toEqual([])
    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]
    expect(candidate?.method).toBe(ECandidateMethod.HistoricalReconstruction)
    expect(candidate?.snapshot.scope.kind).toBe(EQualityScopeKind.Class)
    expect(candidate?.snapshot.scope.before).toBeNull()
    expect(candidate?.snapshot.path).toBe('example.ts')
    expect(candidate?.provenance.session).not.toContain('private-session')
  })

  test('redacts credential assignments without changing the declaration syntax', () => {
    const result = curateRecoveredChange({ ...source, change: {
      ...source.change, after: 'export function credential() { const token = "private-test-value"; return token }\n',
    } })
    expect(result.rejections).toEqual([])
    expect(result.candidates[0]?.snapshot.scope.after).toContain('token = "<redacted>"')
    expect(JSON.stringify(result)).not.toContain('private-test-value')
  })

  test('quarantines unallowlisted personal data and URLs rather than leaking them', () => {
    const result = curateRecoveredChange({ ...source, change: {
      ...source.change, after: 'export function address() { return "person@example.invalid" }\n',
    } })
    expect(result.candidates).toEqual([])
    expect(result.rejections[0]?.reason).toContain('personal identifier')
  })

  test('isolates the entire repository, including different sessions and files', () => {
    const first = curateRecoveredChange(source).candidates[0]
    const second = curateRecoveredChange({ ...source, session: 'another-session', change: { ...source.change, path: '/project/other.ts' } }).candidates[0]
    expect(first?.group).toBe(second?.group)
  })
})
