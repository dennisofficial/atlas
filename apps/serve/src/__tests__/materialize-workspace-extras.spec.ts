import { describe, expect, it } from 'bun:test'

import { EBootStepState, type CloneRepoProgress } from '@dltech/atlas-wire'

import { EWorkspaceState, EWorkspaceStep } from '../materialize-workspace'

import { argsOf, harness, revParseAnswers, spec, TOKEN } from './materialize-workspace-fixture'

const BRANCH_SPEC = {
  remoteUrl: 'https://github.com/octocat/Hello-World.git',
  baseBranch: 'test',
  additionalRepos: [
    { repo: 'octocat/Spoon-Knife', branch: 'test-branch' },
    { repo: 'octocat/linguist' },
  ],
}

describe('ensureWorkspace additional repos', () => {
  it('clones each additional repo beside the workspace on its branch, blobless', async () => {
    const { ensure, attempts, emptied } = harness({ answers: revParseAnswers })

    const readiness = await ensure({
      cwd: '/atlas/workspaces/Hello-World',
      fetchSpec: async () => spec(BRANCH_SPEC),
    })

    expect(readiness).toMatchObject({ state: EWorkspaceState.Materialized })
    expect(emptied.sort()).toEqual([
      '/atlas/workspaces/Hello-World',
      '/atlas/workspaces/Spoon-Knife',
      '/atlas/workspaces/linguist',
    ])
    expect(attempts).toContainEqual({
      args: [
        'clone',
        '--filter=blob:none',
        '--branch',
        'test-branch',
        '--',
        `https://x-access-token:${TOKEN}@github.com/octocat/Spoon-Knife.git`,
        '/atlas/workspaces/Spoon-Knife',
      ],
      cwd: '/atlas/workspaces',
    })
    expect(attempts).toContainEqual({
      args: ['remote', 'set-url', 'origin', 'https://github.com/octocat/Spoon-Knife.git'],
      cwd: '/atlas/workspaces/Spoon-Knife',
    })
    expect(attempts).toContainEqual({
      args: [
        'clone',
        '--filter=blob:none',
        '--',
        `https://x-access-token:${TOKEN}@github.com/octocat/linguist.git`,
        '/atlas/workspaces/linguist',
      ],
      cwd: '/atlas/workspaces',
    })
  })

  it('clones additional repos before it writes the sentinel', async () => {
    const { ensure, attempts, written } = harness({ answers: revParseAnswers })

    await ensure({
      cwd: '/atlas/workspaces/Hello-World',
      fetchSpec: async () => spec(BRANCH_SPEC),
    })

    expect(written).toHaveLength(1)
    expect(argsOf(attempts).at(-1)).toEqual(['rev-parse', '--verify', 'HEAD'])
  })

  it('empties the extra target when its remote disarm fails and records that repo as errored', async () => {
    const { ensure, emptied, written } = harness({
      answers: revParseAnswers,
      fails: (attempt) =>
        attempt.args[0] === 'remote' && attempt.cwd === '/atlas/workspaces/Spoon-Knife'
          ? { stderr: 'fatal: could not set the remote' }
          : undefined,
    })

    const readiness = await ensure({
      cwd: '/atlas/workspaces/Hello-World',
      fetchSpec: async () => spec(BRANCH_SPEC),
    })

    expect(emptied.filter((path) => path === '/atlas/workspaces/Spoon-Knife')).toHaveLength(2)
    expect(readiness).toMatchObject({ state: EWorkspaceState.Materialized })
    expect(written).toHaveLength(1)
  })

  it('refuses an extra repo whose name would climb out of the workspace directory before emptying anything', async () => {
    for (const repo of ['o/..', 'o/.']) {
      const { ensure, attempts, emptied, written } = harness({
        answers: revParseAnswers,
      })

      const readiness = await ensure({
        cwd: '/atlas/workspaces/Hello-World',
        fetchSpec: async () => spec({ ...BRANCH_SPEC, additionalRepos: [{ repo }] }),
      })

      expect(readiness).toMatchObject({
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
      })
      expect(JSON.stringify(readiness)).toContain(`${repo}: `)
      expect(emptied).toEqual([])
      expect(attempts).toEqual([])
      expect(written).toEqual([])
    }
  })

  it('refuses two extras that share a target directory before emptying anything', async () => {
    const { ensure, attempts, emptied } = harness({ answers: revParseAnswers })

    const readiness = await ensure({
      cwd: '/atlas/workspaces/Hello-World',
      fetchSpec: async () =>
        spec({
          ...BRANCH_SPEC,
          additionalRepos: [{ repo: 'a/shared' }, { repo: 'b/shared' }],
        }),
    })

    expect(readiness).toMatchObject({
      state: EWorkspaceState.Failed,
      step: EWorkspaceStep.Clone,
    })
    expect(emptied).toEqual([])
    expect(attempts).toEqual([])
  })

  it('keeps the workspace Materialized, with that repo errored, when an extra will not clone', async () => {
    const { ensure, written } = harness({
      answers: revParseAnswers,
      fails: (attempt) =>
        attempt.args.some((one) => one.includes('Spoon-Knife')) && attempt.args[0] === 'clone'
          ? {
              stderr: `fatal: could not read https://x-access-token:${TOKEN}@github.com/octocat/Spoon-Knife.git`,
            }
          : undefined,
    })

    const readiness = await ensure({
      cwd: '/atlas/workspaces/Hello-World',
      fetchSpec: async () => spec(BRANCH_SPEC),
    })

    expect(readiness).toMatchObject({
      state: EWorkspaceState.Materialized,
      repos: [
        { repo: 'octocat/Hello-World', state: EBootStepState.Done },
        { repo: 'octocat/Spoon-Knife', state: EBootStepState.Error },
        { repo: 'octocat/linguist', state: EBootStepState.Done },
      ],
    })
    expect(JSON.stringify(readiness)).not.toContain(TOKEN)
    expect(written).toHaveLength(1)
  })

  it('starts the primary and every extra clone before any of them finishes', async () => {
    const started: string[] = []
    const release: (() => void)[] = []
    const { ensure } = harness({
      answers: revParseAnswers,
      gate: (attempt) => {
        if (attempt.args[0] !== 'clone') return undefined
        started.push(attempt.cwd)
        return new Promise<void>((resolve) => release.push(resolve))
      },
    })

    const pending = ensure({
      cwd: '/atlas/workspaces/Hello-World',
      fetchSpec: async () => spec(BRANCH_SPEC),
    })
    await Bun.sleep(5)

    expect(started).toHaveLength(3)
    for (const resolve of release) resolve()
    expect(await pending).toMatchObject({
      state: EWorkspaceState.Materialized,
    })
  })

  it('reports the full ordered repo list each time a repo changes state', async () => {
    const { ensure } = harness({ answers: revParseAnswers })
    const seen: CloneRepoProgress[][] = []

    await ensure({
      cwd: '/atlas/workspaces/Hello-World',
      fetchSpec: async () => spec(BRANCH_SPEC),
      progress: (repos) => seen.push(repos),
    })

    const names = ['octocat/Hello-World', 'octocat/Spoon-Knife', 'octocat/linguist']
    expect(seen).toHaveLength(4)
    for (const list of seen) expect(list.map((one) => one.repo)).toEqual(names)
    expect(seen[0]?.every((one) => one.state === EBootStepState.Running)).toBe(true)
    expect(seen.at(-1)?.every((one) => one.state === EBootStepState.Done)).toBe(true)
  })

  it('lets extras settle and fails with a scrubbed message when git throws for the primary', async () => {
    const { ensure } = harness({
      answers: revParseAnswers,
      gate: async (attempt) => {
        if (
          attempt.args.includes(
            `https://x-access-token:${TOKEN}@github.com/octocat/Hello-World.git`,
          )
        )
          throw new Error(`spawn failed for ${TOKEN}`)
      },
    })

    const readiness = await ensure({
      cwd: '/atlas/workspaces/Hello-World',
      fetchSpec: async () => spec(BRANCH_SPEC),
    })

    expect(readiness).toMatchObject({
      state: EWorkspaceState.Failed,
      step: EWorkspaceStep.Clone,
      reason: 'spawn failed for ***',
      repos: [
        { repo: 'octocat/Hello-World', state: EBootStepState.Error },
        { repo: 'octocat/Spoon-Knife', state: EBootStepState.Done },
        { repo: 'octocat/linguist', state: EBootStepState.Done },
      ],
    })
  })
})
