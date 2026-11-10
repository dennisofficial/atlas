import { describe, expect, it } from 'bun:test'

import { resolveSkillShadowing } from '../precedence'
import { ESkillOrigin, ESkillWarning } from '../spec'

const skill = (name: string, origin: ESkillOrigin) => ({ name, origin, warnings: [] })

describe('resolveSkillShadowing', () => {
  it('ranks repo over cloud project over cloud user over built-in, whatever the array order', () => {
    const resolved = resolveSkillShadowing([
      skill('alpha', ESkillOrigin.BuiltIn),
      skill('alpha', ESkillOrigin.CloudUser),
      skill('alpha', ESkillOrigin.CloudProject),
      skill('alpha', ESkillOrigin.Repo),
    ])
    expect(resolved.kept).toEqual([skill('alpha', ESkillOrigin.Repo)])
    expect(resolved.shadowed.map((row) => row.shadowed.origin)).toEqual([
      ESkillOrigin.BuiltIn,
      ESkillOrigin.CloudUser,
      ESkillOrigin.CloudProject,
    ])
  })

  it('keeps the earlier definition on a same-origin tie', () => {
    const first = skill('alpha', ESkillOrigin.Repo)
    const second = {
      ...skill('alpha', ESkillOrigin.Repo),
      warnings: [{ code: ESkillWarning.MissingDescription, detail: 'y' }],
    }
    expect(resolveSkillShadowing([first, second]).kept).toEqual([first])
  })

  it('sorts the kept skills by name and reports every shadowed entry', () => {
    const resolved = resolveSkillShadowing([
      skill('zeta', ESkillOrigin.CloudUser),
      skill('alpha', ESkillOrigin.BuiltIn),
      skill('alpha', ESkillOrigin.BuiltIn),
    ])
    expect(resolved.kept.map((one) => one.origin)).toEqual([
      ESkillOrigin.BuiltIn,
      ESkillOrigin.CloudUser,
    ])
    expect(resolved.shadowed).toHaveLength(1)
  })
})
