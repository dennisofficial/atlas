import { describe, expect, it } from 'bun:test'

import {
  createEnsureWorkspace,
  credentialedRemoteOf,
  EWorkspaceState,
  EWorkspaceStep,
  httpsRemoteOf,
  WORKSPACE_SENTINEL,
  type GitRunner,
} from '../materialize-workspace'
import type { WorkspaceFiles } from '../workspace-files'
import type { WorkspaceSpec } from '../workspace-spec'

const CWD = '/vercel/sandbox/workspace'

const TOKEN = 'gho_secret-token'

const spec = (partial: Partial<WorkspaceSpec> = {}): WorkspaceSpec => ({
  remoteUrl: 'git@github.com:dennisofficial/atlas.git',
  branch: 'dennis/container-cloud',
  commit: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
  patch: '',
  githubToken: TOKEN,
  ...partial,
})

type Attempt = { args: readonly string[]; cwd: string }

const harness = (args: {
  present?: readonly string[] | undefined
  fails?: ((attempt: Attempt) => { stderr: string } | undefined) | undefined
}) => {
  const attempts: Attempt[] = []
  const written: { path: string; text: string }[] = []
  const emptied: string[] = []
  const present = new Set(args.present ?? [])

  const git: GitRunner = async (attempt) => {
    attempts.push(attempt)
    const failure = args.fails?.(attempt)
    if (failure !== undefined) return { ok: false, stdout: '', stderr: failure.stderr }
    return { ok: true, stdout: '', stderr: '' }
  }

  const files: WorkspaceFiles = {
    exists: async (path) => present.has(path),
    write: async (given) => {
      written.push(given)
      present.add(given.path)
    },
    empty: async (path) => {
      emptied.push(path)
    },
  }

  return { attempts, written, emptied, ensure: createEnsureWorkspace({ git, files }) }
}

const argsOf = (attempts: readonly Attempt[]): string[][] =>
  attempts.map((attempt) => [...attempt.args])

describe('ensureWorkspace', () => {
  it('clones, detaches at the commit and applies the patch', async () => {
    const { ensure, attempts, written, emptied } = harness({})

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => spec({ patch: 'diff --git a/x b/x\n' }),
    })

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
      ['checkout', '--detach', '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c'],
      ['apply', '--whitespace=nowarn', `${CWD}/.git/atlas-workspace.patch`],
    ])
    expect(written.at(-1)?.path).toBe(`${CWD}/${WORKSPACE_SENTINEL}`)
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
      fetchSpec: async () => spec({ remoteUrl: null, branch: null, commit: null }),
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Skipped })
    expect(attempts).toEqual([])
  })

  it('checks out the branch when there is no commit', async () => {
    const { ensure, attempts } = harness({})

    await ensure({ cwd: CWD, fetchSpec: async () => spec({ commit: null }) })

    expect(argsOf(attempts).at(-1)).toEqual(['checkout', 'dennis/container-cloud'])
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

  it('surfaces a patch that will not apply rather than serving a clean tree', async () => {
    const { ensure, written } = harness({
      fails: (attempt) =>
        attempt.args[0] === 'apply' ? { stderr: 'error: patch does not apply' } : undefined,
    })

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => spec({ patch: 'diff --git a/x b/x\n' }),
    })

    expect(readiness).toEqual({
      state: EWorkspaceState.Failed,
      step: EWorkspaceStep.Apply,
      reason: 'error: patch does not apply',
    })
    expect(written.some((one) => one.path.endsWith(WORKSPACE_SENTINEL))).toBe(false)
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

describe('remote urls', () => {
  it('reaches an ssh remote over https so a token can authenticate it', () => {
    expect(httpsRemoteOf('git@github.com:dennisofficial/atlas.git')).toBe(
      'https://github.com/dennisofficial/atlas.git',
    )
    expect(httpsRemoteOf('ssh://git@github.com/dennisofficial/atlas.git')).toBe(
      'https://github.com/dennisofficial/atlas.git',
    )
    expect(httpsRemoteOf('https://github.com/dennisofficial/atlas.git')).toBe(
      'https://github.com/dennisofficial/atlas.git',
    )
  })

  it('leaves the remote alone when there is no token to carry', () => {
    expect(
      credentialedRemoteOf({ remoteUrl: 'git@github.com:dennisofficial/atlas.git', token: null }),
    ).toBe('git@github.com:dennisofficial/atlas.git')
  })
})
