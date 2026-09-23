import { describe, expect, it } from 'bun:test'

import { EPortExposure } from '@dltech/atlas-core'

import type { ApplyEnvironmentProfile, EnvironmentProfile } from '../environment-profile'
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

const CWD = '/workspace'

const TOKEN = 'gho_secret-token'

const spec = (partial: Partial<WorkspaceSpec> = {}): WorkspaceSpec => ({
  remoteUrl: 'git@github.com:dennisofficial/atlas.git',
  branch: 'dennis/container-cloud',
  commit: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
  patch: '',
  githubToken: TOKEN,
  contextBundle: null,
  ...partial,
})

type Attempt = { args: readonly string[]; cwd: string }

const harness = (args: {
  present?: readonly string[] | undefined
  fails?: ((attempt: Attempt) => { stderr: string } | undefined) | undefined
  answers?: ((attempt: Attempt) => string | undefined) | undefined
  profile?: ApplyEnvironmentProfile | undefined
}) => {
  const attempts: Attempt[] = []
  const written: { path: string; text: string }[] = []
  const emptied: string[] = []
  const present = new Set(args.present ?? [])

  const git: GitRunner = async (attempt) => {
    attempts.push(attempt)
    const failure = args.fails?.(attempt)
    if (failure !== undefined) return { ok: false, stdout: '', stderr: failure.stderr }
    return { ok: true, stdout: args.answers?.(attempt) ?? '', stderr: '' }
  }

  const files: WorkspaceFiles = {
    exists: async (path) => present.has(path),
    read: async () => {
      throw new Error('not exercised in these specs')
    },
    write: async (given) => {
      written.push(given)
      present.add(given.path)
    },
    writeBytes: async ({ path, bytes }) => {
      written.push({ path, text: bytes.toString('utf8') })
      present.add(path)
    },
    empty: async (path) => {
      emptied.push(path)
    },
  }

  return { attempts, written, emptied, ensure: createEnsureWorkspace({ git, files, profile: args.profile }) }
}

const argsOf = (attempts: readonly Attempt[]): string[][] =>
  attempts.map((attempt) => [...attempt.args])

const TIP = 'ba51e1e0000000000000000000000000000000ff'

const TREE = '7ee1ab1e000000000000000000000000000000aa'

const PATCHED_TREE = '1f2e3d4c000000000000000000000000000000bb'

const revParseAnswers = (attempt: Attempt): string | undefined => {
  if (attempt.args[0] === 'write-tree') return `${PATCHED_TREE}\n`
  if (attempt.args[0] !== 'rev-parse') return undefined
  return attempt.args.at(-1) === 'HEAD^{tree}' ? `${TREE}\n` : `${TIP}\n`
}

describe('ensureWorkspace', () => {
  it('clones, arrives on the branch at the lifted commit and applies the patch uncommitted', async () => {
    const { ensure, attempts, written, emptied } = harness({ answers: revParseAnswers })

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
      ['checkout', '-B', 'dennis/container-cloud', '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c'],
      ['rev-parse', '--verify', 'HEAD'],
      ['rev-parse', '--verify', 'HEAD^{tree}'],
      ['apply', '--whitespace=nowarn', `${CWD}/.git/atlas-workspace.patch`],
      ['add', '-A'],
      ['write-tree'],
      ['reset'],
    ])
    expect(written.at(-1)?.path).toBe(`${CWD}/${WORKSPACE_SENTINEL}`)
  })

  it('records the branch tip and its tree in the sentinel for the descend to merge against', async () => {
    const { ensure, written } = harness({ answers: revParseAnswers })

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => spec({ patch: 'diff --git a/x b/x\n' }),
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Materialized })
    const sentinel = written.find((one) => one.path.endsWith(WORKSPACE_SENTINEL))
    expect(JSON.parse(sentinel?.text ?? '{}')).toMatchObject({
      commit: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
      baseline: TIP,
      baselineTree: PATCHED_TREE,
      branch: 'dennis/container-cloud',
    })
  })

  it('records the checkout tree as the baseline tree when no patch rode up', async () => {
    const { ensure, attempts, written } = harness({ answers: revParseAnswers })

    const readiness = await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(readiness).toEqual({ state: EWorkspaceState.Materialized })
    expect(argsOf(attempts).some((args) => args[0] === 'write-tree')).toBe(false)
    const sentinel = written.find((one) => one.path.endsWith(WORKSPACE_SENTINEL))
    expect(JSON.parse(sentinel?.text ?? '{}')).toMatchObject({ baselineTree: TREE })
  })

  it('never commits the lifted work, and unstages what the tree recording staged', async () => {
    const { ensure, attempts } = harness({ answers: revParseAnswers })

    await ensure({ cwd: CWD, fetchSpec: async () => spec({ patch: 'diff --git a/x b/x\n' }) })

    const args = argsOf(attempts)
    expect(args.some((one) => one.includes('commit'))).toBe(false)
    const added = args.findIndex((one) => one[0] === 'add')
    expect(added).toBeGreaterThan(-1)
    expect(args.findIndex((one) => one[0] === 'reset')).toBeGreaterThan(added)
  })

  it('surfaces a baseline tree that would not write rather than serving an unmergeable tree', async () => {
    const { ensure, written } = harness({
      fails: (attempt) =>
        attempt.args[0] === 'write-tree' ? { stderr: 'unmerged entries' } : undefined,
    })

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => spec({ patch: 'diff --git a/x b/x\n' }),
    })

    expect(readiness).toEqual({
      state: EWorkspaceState.Failed,
      step: EWorkspaceStep.Baseline,
      reason: 'unmerged entries',
    })
    expect(written.some((one) => one.path.endsWith(WORKSPACE_SENTINEL))).toBe(false)
  })

  it('detaches at the commit when the operator was not on a branch', async () => {
    const { ensure, attempts } = harness({ answers: revParseAnswers })

    await ensure({ cwd: CWD, fetchSpec: async () => spec({ branch: null }) })

    expect(argsOf(attempts)).toContainEqual([
      'checkout',
      '--detach',
      '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
    ])
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

    expect(argsOf(attempts)).toContainEqual(['checkout', 'dennis/container-cloud'])
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

describe('ensureWorkspace environment profile', () => {
  const profile: EnvironmentProfile = {
    steps: [],
    capabilities: {
      canPush: true,
      gitIdentity: null,
      gpgSigning: false,
      dockerAvailable: false,
      persistentFs: true,
      serviceTtlSeconds: null,
      portExposure: EPortExposure.PublicDomain,
      failures: [],
    },
  }

  it('re-applies the profile on a present workspace, fetching the spec for it', async () => {
    let fetched = 0
    const { ensure } = harness({
      present: [`${CWD}/${WORKSPACE_SENTINEL}`],
      profile: async () => profile,
    })

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => {
        fetched += 1
        return spec()
      },
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Present, profile })
    expect(fetched).toBe(1)
  })

  it('carries the profile on a materialized workspace', async () => {
    const { ensure } = harness({ profile: async () => profile })

    const readiness = await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(readiness).toEqual({ state: EWorkspaceState.Materialized, profile })
  })

  it('applies the profile for a workspace-less session too', async () => {
    const { ensure } = harness({ profile: async () => profile })

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => spec({ remoteUrl: null, branch: null, commit: null }),
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Skipped, profile })
  })

  it('still returns the success readiness when the profile throws', async () => {
    const { ensure } = harness({
      profile: async () => {
        throw new Error('the profile blew up')
      },
    })

    const readiness = await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(readiness).toEqual({ state: EWorkspaceState.Materialized })
  })

  it('stays profile-less on a present workspace whose profile fetch throws', async () => {
    const { ensure } = harness({
      present: [`${CWD}/${WORKSPACE_SENTINEL}`],
      profile: async () => profile,
    })

    const readiness = await ensure({
      cwd: CWD,
      fetchSpec: async () => {
        throw new Error('the control plane answered 500')
      },
    })

    expect(readiness).toEqual({ state: EWorkspaceState.Present })
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
