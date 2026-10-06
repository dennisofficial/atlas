import { describe, expect, it } from 'bun:test'

import { outsideProjectNotice } from '../outside-project'

const PROJECT = '/Users/dennis/Developer/atlas/.atlas/worktrees/highlight-loop'

describe('outsideProjectNotice', () => {
  it('stays silent for a write inside the project directory', () => {
    expect(
      outsideProjectNotice({ path: `${PROJECT}/apps/tui/src/main.tsx`, projectDirectory: PROJECT }),
    ).toBeUndefined()
  })

  it('stays silent for the project directory itself', () => {
    expect(outsideProjectNotice({ path: PROJECT, projectDirectory: PROJECT })).toBeUndefined()
  })

  it('resolves a relative path against the project directory', () => {
    expect(
      outsideProjectNotice({ path: 'apps/tui/src/main.tsx', projectDirectory: PROJECT }),
    ).toBeUndefined()
  })

  it('nudges on a write into a sibling worktree, naming both directories', () => {
    const target =
      '/Users/dennis/Developer/atlas/.atlas/worktrees/cheap-shimmer/apps/tui/src/ui/shimmer.ts'

    const notice = outsideProjectNotice({ path: target, projectDirectory: PROJECT })

    expect(notice).toContain(target)
    expect(notice).toContain(PROJECT)
    expect(notice).toContain('enter_worktree')
  })

  it('nudges on a write into another repository under home', () => {
    expect(
      outsideProjectNotice({
        path: '/Users/dennis/Developer/comp-v3/apps/web/src/page.tsx',
        projectDirectory: PROJECT,
      }),
    ).toBeDefined()
  })

  it('nudges on a dotfile deep inside another project', () => {
    expect(
      outsideProjectNotice({
        path: '/Users/dennis/Developer/comp-v3/.env',
        projectDirectory: PROJECT,
      }),
    ).toBeDefined()
  })

  it('stays silent for atlas home', () => {
    expect(
      outsideProjectNotice({
        path: '/Users/dennis/.atlas/projects/-Users-dennis/memory/note.md',
        projectDirectory: PROJECT,
      }),
    ).toBeUndefined()
  })

  it('stays silent for dotfiles and dot-directories straight under home', () => {
    for (const path of [
      '/Users/dennis/.zshrc',
      '/Users/dennis/.config/ghostty/config',
      '/home/dennis/.claude/skills/x/SKILL.md',
      '~/.agents/skills/x/SKILL.md',
    ]) {
      expect(outsideProjectNotice({ path, projectDirectory: PROJECT })).toBeUndefined()
    }
  })

  it('stays silent for temporary roots', () => {
    for (const path of [
      '/tmp/scratch.ts',
      '/private/tmp/scratch.ts',
      '/var/tmp/scratch.ts',
      '/var/folders/9x/abcd/T/build-output.log',
    ]) {
      expect(outsideProjectNotice({ path, projectDirectory: PROJECT })).toBeUndefined()
    }
  })

  it('normalises .. segments before judging', () => {
    expect(
      outsideProjectNotice({
        path: `${PROJECT}/apps/../../comp-v3/src/index.ts`,
        projectDirectory: PROJECT,
      }),
    ).toBeDefined()
  })

  describe('with a session directory', () => {
    const SESSION = '/atlas/home/sessions/session-123'

    const notice = (path: string) =>
      outsideProjectNotice({ path, projectDirectory: PROJECT, sessionDirectory: SESSION })

    it('stays silent for the session root itself and its scratch, context and thread files', () => {
      for (const path of [
        SESSION,
        `${SESSION}/scratch/probe.ts`,
        `${SESSION}/context/plan.md`,
        `${SESSION}/threads/thread-1/notes.md`,
      ]) {
        expect(notice(path)).toBeUndefined()
      }
    })

    it('stays silent for a custom cloud session root', () => {
      const cloudRoot = '/atlas/sessions/cloud-abc'

      for (const path of [`${cloudRoot}/scratch/probe.ts`, `${cloudRoot}/context/plan.md`]) {
        expect(
          outsideProjectNotice({ path, projectDirectory: PROJECT, sessionDirectory: cloudRoot }),
        ).toBeUndefined()
      }
    })

    it('stays silent for a trailing-slash session root and a relative-segment path inside it', () => {
      expect(
        outsideProjectNotice({
          path: `${SESSION}/scratch/probe.ts`,
          projectDirectory: PROJECT,
          sessionDirectory: `${SESSION}/`,
        }),
      ).toBeUndefined()
      expect(notice(`${SESSION}/scratch/../context/plan.md`)).toBeUndefined()
    })

    it('nudges on a prefix-colliding sibling directory', () => {
      expect(notice(`${SESSION}-other/scratch/probe.ts`)).toBeDefined()
      expect(notice(`${SESSION}2/context/plan.md`)).toBeDefined()
    })

    it('nudges on traversal that escapes the session root', () => {
      expect(notice(`${SESSION}/scratch/../../session-456/scratch/probe.ts`)).toBeDefined()
      expect(
        notice(`${SESSION}/../../../Users/dennis/Developer/comp-v3/src/index.ts`),
      ).toBeDefined()
    })

    it('nudges on another session and on the sessions parent', () => {
      expect(notice('/atlas/home/sessions/session-456/scratch/probe.ts')).toBeDefined()
      expect(notice('/atlas/home/sessions/loose.md')).toBeDefined()
    })

    it('nudges on the project-sibling targets it nudged on without a session directory', () => {
      const target = '/Users/dennis/Developer/comp-v3/apps/web/src/page.tsx'

      expect(notice(target)).toBeDefined()
      expect(
        outsideProjectNotice({
          path: target,
          projectDirectory: PROJECT,
          sessionDirectory: undefined,
        }),
      ).toBeDefined()
    })

    it('stays silent for project writes regardless of the session directory', () => {
      expect(notice(`${PROJECT}/apps/tui/src/main.tsx`)).toBeUndefined()
    })

    it('grants nothing for an unspecified, empty, relative or root session directory', () => {
      const target = '/atlas/home/sessions/session-123/scratch/probe.ts'

      for (const sessionDirectory of [undefined, '', '/', 'sessions/session-123', '/..']) {
        expect(
          outsideProjectNotice({ path: target, projectDirectory: PROJECT, sessionDirectory }),
        ).toBeDefined()
      }
    })
  })
})
