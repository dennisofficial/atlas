import { describe, expect, it } from 'bun:test'

import { EWorkspaceState, EWorkspaceStep, WORKSPACE_SENTINEL } from '../materialize-workspace'

import { argsOf, CWD, harness, revParseAnswers, spec, TIP, TOKEN } from './materialize-workspace-fixture'

const BRANCH_SPEC = {
  remoteUrl: 'https://github.com/octocat/Hello-World.git',
  baseBranch: 'test',
  additionalRepos: [
    { repo: 'octocat/Spoon-Knife', branch: 'test-branch' },
    { repo: 'octocat/linguist' },
  ],
}

describe('ensureWorkspace', () => {
  it('clones the default branch full and records the clone’s HEAD in the sentinel', async () => {
    const { ensure, attempts, written, emptied } = harness({ answers: revParseAnswers })

    const readiness = await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(readiness).toEqual({ state: EWorkspaceState.Materialized })
    expect(emptied).toEqual([CWD])
    expect(argsOf(attempts)).toEqual([
      [
        'clone',
        '--',
        `https://x-access-token:${TOKEN}@github.com/dennisofficial/atlas.git`,
        '.',
      ],
      ['remote', 'set-url', 'origin', 'https://github.com/dennisofficial/atlas.git'],
      ['rev-parse', '--verify', 'HEAD'],
    ])
    const sentinel = written.find((one) => one.path.endsWith(WORKSPACE_SENTINEL))
    expect(JSON.parse(sentinel?.text ?? '{}')).toMatchObject({ commit: TIP })
  })

  it('never checks out a branch or applies a patch — the default branch tip is the workspace', async () => {
    const { ensure, attempts } = harness({ answers: revParseAnswers })

    await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    const args = argsOf(attempts)
    expect(args.some((one) => one[0] === 'checkout')).toBe(false)
    expect(args.some((one) => one[0] === 'apply')).toBe(false)
    expect(args.some((one) => one.includes('commit'))).toBe(false)
  })

  it('does nothing at all when the sentinel is already there', async () => {
    const { ensure, attempts, emptied } = harness({
      present: [`${CWD}/${WORKSPACE_SENTINEL}`],
    })

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => {
        throw new Error('the spec must not even be fetched')
      },
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Present })
    expect(attempts).toEqual([])
    expect(emptied).toEqual([])
  })

  it('skips a workspace-less session', async () => {
    const { ensure, attempts } = harness({})

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => spec({ remoteUrl: null }),
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Skipped })
    expect(attempts).toEqual([])
  })

  it('surfaces a clone failure with its step, and never leaves a sentinel behind', async () => {
    const { ensure, written } = harness({
      fails: (attempt) =>
        attempt.args[0] === 'clone' ? { stderr: 'fatal: repository not found' } : undefined,
    })

    const readiness = await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(readiness).toEqual({
      state: EWorkspaceState.Failed,
      step: EWorkspaceStep.Clone,
      reason: 'fatal: repository not found',
    })
    expect(written).toEqual([])
  })

  it('surfaces a spec it could not fetch', async () => {
    const { ensure, emptied } = harness({})

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => {
        throw new Error('the control plane answered 401 for the workspace spec')
      },
    })

    expect(readiness).toEqual({
      state: EWorkspaceState.Failed,
      step: EWorkspaceStep.Fetch,
      reason: 'the control plane answered 401 for the workspace spec',
    })
    expect(emptied).toEqual([])
  })

  it('keeps the git credential out of what it reports', async () => {
    const { ensure } = harness({
      fails: (attempt) =>
        attempt.args[0] === 'clone'
          ? { stderr: `fatal: could not read https://x-access-token:${TOKEN}@github.com` }
          : undefined,
    })

    const readiness = await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(readiness.state).toBe(EWorkspaceState.Failed)
    expect(JSON.stringify(readiness)).not.toContain(TOKEN)
  })

  it('passes the base branch to the primary clone', async () => {
    const { ensure, attempts } = harness({ answers: revParseAnswers })

    await ensure({ cwd: CWD, fetchSpec: async () => spec({ baseBranch: 'release/1.0' }) })

    expect(argsOf(attempts)[0]).toEqual([
      'clone',
      '--branch',
      'release/1.0',
      '--',
      `https://x-access-token:${TOKEN}@github.com/dennisofficial/atlas.git`,
      '.',
    ])
  })

  it('clones each additional repo beside the workspace on its branch and scrubs the token', async () => {
    const { ensure, attempts, emptied } = harness({ answers: revParseAnswers })

    const readiness = await ensure({ cwd: '/atlas/workspaces/Hello-World', fetchSpec: async () => spec(BRANCH_SPEC) })

    expect(readiness).toEqual({ state: EWorkspaceState.Materialized })
    expect(emptied).toEqual([
      '/atlas/workspaces/Hello-World',
      '/atlas/workspaces/Spoon-Knife',
      '/atlas/workspaces/linguist',
    ])
    expect(attempts.slice(2, 6)).toEqual([
      {
        args: [
          'clone',
          '--branch',
          'test-branch',
          '--',
          `https://x-access-token:${TOKEN}@github.com/octocat/Spoon-Knife.git`,
          '/atlas/workspaces/Spoon-Knife',
        ],
        cwd: '/atlas/workspaces',
      },
      {
        args: ['remote', 'set-url', 'origin', 'https://github.com/octocat/Spoon-Knife.git'],
        cwd: '/atlas/workspaces/Spoon-Knife',
      },
      {
        args: [
          'clone',
          '--',
          `https://x-access-token:${TOKEN}@github.com/octocat/linguist.git`,
          '/atlas/workspaces/linguist',
        ],
        cwd: '/atlas/workspaces',
      },
      {
        args: ['remote', 'set-url', 'origin', 'https://github.com/octocat/linguist.git'],
        cwd: '/atlas/workspaces/linguist',
      },
    ])
  })

  it('clones additional repos before it writes the sentinel', async () => {
    const { ensure, attempts, written } = harness({ answers: revParseAnswers })

    await ensure({ cwd: '/atlas/workspaces/Hello-World', fetchSpec: async () => spec(BRANCH_SPEC) })

    expect(written).toHaveLength(1)
    expect(argsOf(attempts).at(-1)).toEqual(['rev-parse', '--verify', 'HEAD'])
  })

  it('empties the extra target when its remote disarm fails, so no credentialed origin survives', async () => {
    const { ensure, emptied, written } = harness({
      fails: (attempt) =>
        attempt.args[0] === 'remote' && attempt.cwd === '/atlas/workspaces/Spoon-Knife'
          ? { stderr: 'fatal: could not set the remote' }
          : undefined,
    })

    const readiness = await ensure({ cwd: '/atlas/workspaces/Hello-World', fetchSpec: async () => spec(BRANCH_SPEC) })

    expect(readiness).toMatchObject({ state: EWorkspaceState.Failed, step: EWorkspaceStep.Clone })
    expect(emptied.filter((path) => path === '/atlas/workspaces/Spoon-Knife')).toHaveLength(2)
    expect(written).toEqual([])
  })

  it('re-clones an extra on the next boot after the first boot failed its disarm', async () => {
    let failDisarm = true
    const { ensure, attempts, written } = harness({
      answers: revParseAnswers,
      fails: (attempt) =>
        failDisarm && attempt.args[0] === 'remote' && attempt.cwd === '/atlas/workspaces/Spoon-Knife'
          ? { stderr: 'fatal: could not set the remote' }
          : undefined,
    })
    const boot = () => ensure({ cwd: '/atlas/workspaces/Hello-World', fetchSpec: async () => spec(BRANCH_SPEC) })

    expect((await boot()).state).toBe(EWorkspaceState.Failed)
    failDisarm = false
    attempts.length = 0
    const second = await boot()

    expect(second).toEqual({ state: EWorkspaceState.Materialized })
    expect(JSON.stringify(argsOf(attempts))).toContain('/atlas/workspaces/Spoon-Knife')
    expect(written).toHaveLength(1)
  })

  it('refuses an extra repo whose name would climb out of the workspace directory and empties nothing for it', async () => {
    for (const repo of ['o/..', 'o/.']) {
      const { ensure, attempts, emptied, written } = harness({ answers: revParseAnswers })

      const readiness = await ensure({
        cwd: '/atlas/workspaces/Hello-World',
        fetchSpec: async () => spec({ ...BRANCH_SPEC, additionalRepos: [{ repo }] }),
      })

      expect(readiness).toMatchObject({ state: EWorkspaceState.Failed, step: EWorkspaceStep.Clone })
      expect(JSON.stringify(readiness)).toContain(`${repo}: `)
      expect(emptied).toEqual(['/atlas/workspaces/Hello-World'])
      expect(argsOf(attempts).some((one) => one[0] === 'clone' && one.includes(repo))).toBe(false)
      expect(written).toEqual([])
    }
  })

  it('fails the workspace at clone, naming the repo, when an additional repo will not clone', async () => {
    const { ensure, written } = harness({
      fails: (attempt) =>
        attempt.args.some((one) => one.includes('Spoon-Knife')) && attempt.args[0] === 'clone'
          ? { stderr: `fatal: could not read https://x-access-token:${TOKEN}@github.com/octocat/Spoon-Knife.git` }
          : undefined,
    })

    const readiness = await ensure({ cwd: '/atlas/workspaces/Hello-World', fetchSpec: async () => spec(BRANCH_SPEC) })

    expect(readiness).toMatchObject({ state: EWorkspaceState.Failed, step: EWorkspaceStep.Clone })
    expect(JSON.stringify(readiness)).toContain('octocat/Spoon-Knife: ')
    expect(JSON.stringify(readiness)).not.toContain(TOKEN)
    expect(written).toEqual([])
  })

  it('gives a remoteless project an empty workspace without touching git', async () => {
    const { ensure, attempts } = harness({})

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => spec({ remoteUrl: null, projectId: 'proj-1', baseBranch: null, additionalRepos: [] }),
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Skipped })
    expect(attempts).toEqual([])
  })
})
