import { describe, expect, it } from 'bun:test'

import { EWorkspaceState, EWorkspaceStep, WORKSPACE_SENTINEL } from '../materialize-workspace'

import { argsOf, CWD, harness, revParseAnswers, spec, TIP, TOKEN } from './materialize-workspace-fixture'

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
})
