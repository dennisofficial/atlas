import { describe, expect, it } from 'bun:test'

import { homedir } from 'node:os'
import { join } from 'node:path'

import { materializeSkills } from '../materialize-skills'
import type { WorkspaceFiles } from '../workspace-files'
import type { WorkspaceSpec } from '../workspace-spec'

const SPEC: WorkspaceSpec = {
  remoteUrl: null,
  branch: null,
  commit: null,
  patch: '',
  githubToken: null,
  skillsBundle: null,
}

const fakeFiles = () => {
  const written = new Map<string, string>()
  const files: WorkspaceFiles = {
    exists: async () => false,
    write: async ({ path, text }) => {
      written.set(path, text)
    },
    empty: async () => undefined,
  }
  return { files, written }
}

const bundle = (entries: Record<string, string>): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(entries).map(([path, text]) => [path, Buffer.from(text, 'utf8').toString('base64')]),
    ),
  )

describe('materializeSkills', () => {
  it('writes each flavour where the serve’s registry looks for it', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      skillsBundle: bundle({
        '.atlas/skills/review/SKILL.md': '# review',
        '.agents/skills/explore/SKILL.md': '# explore',
        '.claude/skills/notes.md': '# notes',
      }),
    }

    const readiness = await materializeSkills({
      fetchSpec: async () => spec,
      atlasHome: '/srv/atlas-home',
      files,
    })

    expect(readiness).toEqual({ written: 3, failed: null })
    expect(written.get('/srv/atlas-home/skills/review/SKILL.md')).toBe('# review')
    expect(written.get(join(homedir(), '.agents', 'skills', 'explore', 'SKILL.md'))).toBe(
      '# explore',
    )
    expect(written.get(join(homedir(), '.claude', 'skills', 'notes.md'))).toBe('# notes')
    expect(written.size).toBe(3)
  })

  it('does nothing when the spec carries no bundle', async () => {
    const { files, written } = fakeFiles()

    const readiness = await materializeSkills({
      fetchSpec: async () => SPEC,
      atlasHome: '/srv/atlas-home',
      files,
    })

    expect(readiness).toEqual({ written: 0, failed: null })
    expect(written.size).toBe(0)
  })

  it('tolerates an older control plane that does not know the field', async () => {
    const { files } = fakeFiles()
    const legacy = {
      remoteUrl: null,
      branch: null,
      commit: null,
      patch: '',
      githubToken: null,
    }

    const readiness = await materializeSkills({
      fetchSpec: async () => legacy as WorkspaceSpec,
      atlasHome: '/srv/atlas-home',
      files,
    })

    expect(readiness).toEqual({ written: 0, failed: null })
  })

  it('reports an unparseable bundle without failing the boot', async () => {
    const { files } = fakeFiles()

    const readiness = await materializeSkills({
      fetchSpec: async () => ({ ...SPEC, skillsBundle: 'not json' }),
      atlasHome: '/srv/atlas-home',
      files,
    })

    expect(readiness.written).toBe(0)
    expect(readiness.failed).toContain('did not parse')
  })

  it('refuses paths that climb out of the skill roots', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      skillsBundle: bundle({
        '../escape/SKILL.md': '# nope',
        '.atlas/skills/good/SKILL.md': '# fine',
      }),
    }

    const readiness = await materializeSkills({
      fetchSpec: async () => spec,
      atlasHome: '/srv/atlas-home',
      files,
    })

    expect(readiness.written).toBe(1)
    expect([...written.keys()].every((path) => !path.includes('escape'))).toBe(true)
  })
})
