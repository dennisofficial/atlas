import { describe, expect, it } from 'bun:test'

import { frontmatterOf, skillBodyOf } from '../frontmatter'
import { skillFrontmatterOf } from '../parse'
import { ESkillWarning } from '../spec'
import { validateSkill } from '../validate'

const parsed = (text: string, fallbackName = 'folder') =>
  skillFrontmatterOf({ fields: frontmatterOf(text), fallbackName })

describe('skillFrontmatterOf', () => {
  it('reads the fenced fields and leaves the body out', () => {
    const text = '---\nname: alpha\ndescription: does alpha\nwhen_to_use: when alpha\n---\n\nbody'
    expect(parsed(text)).toMatchObject({
      name: 'alpha',
      description: 'does alpha',
      whenToUse: 'when alpha',
      userInvocable: true,
      modelInvocable: true,
    })
    expect(skillBodyOf(text)).toBe('body')
  })

  it('lowercases the name and falls back to the directory name', () => {
    expect(parsed('---\nname: MiXeD\n---\n').name).toBe('mixed')
    expect(parsed('---\ndescription: d\n---\n', 'Folder-Name').name).toBe('folder-name')
  })

  it('strips quotes from a description that holds punctuation and keeps colons', () => {
    const frontmatter = parsed('---\ndescription: "One: two, \'three\'"\n---\n')
    expect(frontmatter.description).toBe("One: two, 'three'")
  })

  it('reads the two switches and a flow-list argument hint', () => {
    const frontmatter = parsed(
      '---\nuser-invocable: no\ndisable-model-invocation: true\nargument-hint: [scope]\n---\n',
    )
    expect(frontmatter.userInvocable).toBe(false)
    expect(frontmatter.modelInvocable).toBe(false)
    expect(frontmatter.argumentHint).toBe('[scope]')
  })

  it('keeps an unknown field as unrecognised and warns about it without rejecting', () => {
    const frontmatter = parsed('---\nname: alpha\ndescription: d\nowner: dennis\n---\n')
    expect([...frontmatter.unrecognised.keys()]).toEqual(['owner'])
    const warnings = validateSkill({ frontmatter, directoryName: 'alpha' })
    expect(warnings.map((warning) => warning.code)).toEqual([ESkillWarning.UnknownField])
  })

  it('treats a v1 field v2 does not read as known, so it is not an unknown-field warning', () => {
    const frontmatter = parsed(
      '---\nname: alpha\ndescription: d\nlicense: MIT\nmetadata:\n  owner: x\n---\n',
    )
    expect(validateSkill({ frontmatter, directoryName: 'alpha' })).toEqual([])
  })
})

describe('validateSkill', () => {
  it('warns about a missing description, a bashy name and a directory mismatch', () => {
    const frontmatter = parsed('---\nname: Not_A_Name\n---\n', 'other')
    const codes = validateSkill({ frontmatter, directoryName: 'other' }).map((one) => one.code)
    expect(codes).toContain(ESkillWarning.MissingDescription)
    expect(codes).toContain(ESkillWarning.NameCharset)
    expect(codes).toContain(ESkillWarning.NameDirectoryMismatch)
  })

  it('never rejects a skill: a long description is a warning and the skill still parses', () => {
    const long = 'x'.repeat(2000)
    const frontmatter = parsed(`---\nname: alpha\ndescription: ${long}\n---\n`)
    expect(frontmatter.description.length).toBe(2000)
    expect(validateSkill({ frontmatter, directoryName: 'alpha' }).map((one) => one.code)).toEqual([
      ESkillWarning.DescriptionTooLong,
    ])
  })
})

describe('frontmatterOf', () => {
  it('ignores a file with no fence and a nested block under a recognised key', () => {
    expect([...frontmatterOf('no frontmatter here').keys()]).toEqual([])
    expect([...frontmatterOf('---\nname: a\nmetadata:\n  owner: x\n---\n').keys()]).toEqual([
      'name',
    ])
  })
})
