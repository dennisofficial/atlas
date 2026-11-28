import { describe, expect, it } from 'bun:test'
import {
  defaultSkillPath,
  skillFilePathProblem,
  skillFileTargetOf,
  skillPathContains,
  skillRenamePlan,
} from '../skill-file-path'

const problem = (path: string) => skillFilePathProblem({ path, takenPaths: [] })

describe('skill file paths', () => {
  it('opens the entry, text fallback, binary fallback or nothing', () => {
    expect(defaultSkillPath({ metas: [] })).toBeNull()
    expect(
      defaultSkillPath({
        metas: [
          { path: 'logo.png', isText: false },
          { path: 'SKILL.md', isText: true },
        ],
      }),
    ).toBe('SKILL.md')
    expect(
      defaultSkillPath({
        metas: [
          { path: 'logo.png', isText: false },
          { path: 'notes.md', isText: true },
        ],
      }),
    ).toBe('notes.md')
    expect(defaultSkillPath({ metas: [{ path: 'logo.png', isText: false }] })).toBe('logo.png')
  })
  it('resolves inside the chosen folder', () => {
    expect(skillFileTargetOf({ basePath: 'references', value: ' /notes.md/ ' })).toBe(
      'references/notes.md',
    )
    expect(skillFileTargetOf({ basePath: '', value: 'notes.md' })).toBe('notes.md')
  })
  it('rejects ambiguous or escaping paths', () => {
    for (const path of ['', '/notes.md', 'a//b', './a', 'a/../b', 'a\\b', 'a\u0000b'])
      expect(problem(path)).not.toBeNull()
    expect(problem('references/notes.md')).toBeNull()
  })
  it('rejects file and folder collisions, including renames', () => {
    const takenPaths = ['SKILL.md', 'references/a.md', 'notes.md']
    for (const path of ['SKILL.md', 'references', 'notes.md/child'])
      expect(skillFilePathProblem({ path, takenPaths })).not.toBeNull()
    expect(skillFilePathProblem({ path: 'notes.md', from: 'SKILL.md', takenPaths })).not.toBeNull()
    expect(skillFilePathProblem({ path: 'SKILL.md', from: 'SKILL.md', takenPaths })).not.toBeNull()
    expect(
      skillFilePathProblem({
        path: 'references/child',
        from: 'references',
        folder: true,
        takenPaths,
      }),
    ).not.toBeNull()
  })
  it('plans a rename without matching similarly prefixed siblings', () => {
    const files = [
      { path: 'refs/a.md', revision: 2 },
      { path: 'refs/b.md', revision: 3 },
      { path: 'refs-other.md', revision: 1 },
    ]
    expect(skillRenamePlan({ files, from: 'refs', to: 'guides' })).toEqual([
      { file: { path: 'refs/a.md', revision: 2 }, path: 'guides/a.md' },
      { file: { path: 'refs/b.md', revision: 3 }, path: 'guides/b.md' },
    ])
    expect(skillPathContains({ parent: 'refs', path: 'refs-other.md' })).toBe(false)
    expect(() => skillRenamePlan({ files, from: 'refs', to: 'refs-other.md' })).toThrow()
  })
})
