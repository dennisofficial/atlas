import { describe, expect, it } from 'bun:test'

import { EPortExposure } from '@dltech/atlas-core'

import {
  createEnvironmentProfile,
  EProfileStep,
  EProfileStepState,
  type EnvironmentProfile,
  type ProfileStepOutcome,
} from '../environment-profile'
import type { GitRunner } from '../materialize-workspace'
import type { CommandRunner } from '../run-command'
import type { WorkspaceFiles } from '../workspace-files'
import type { WorkspaceSpec } from '../workspace-spec'

const CWD = '/workspace'
const HOME = '/home/sandbox'
const TOKEN = 'gho_secret-token'
const KNOWN_HOSTS = `${HOME}/.ssh/known_hosts`
const KEYSCAN_OUTPUT = 'github.com ssh-rsa AAAAFakeKey\n'

const spec = (partial: Partial<WorkspaceSpec> = {}): WorkspaceSpec => ({
  remoteUrl: 'git@github.com:dennisofficial/atlas.git',
  branch: 'main',
  commit: null,
  patch: '',
  githubToken: TOKEN,
  contextBundle: null,
  ...partial,
})

type CommandAttempt = { command: readonly string[]; cwd: string }
type GitAttempt = { args: readonly string[]; cwd: string }

const harness = (args: {
  contents?: Record<string, string> | undefined
  present?: readonly string[] | undefined
  env?: Record<string, string | undefined> | undefined
  runFails?: ((attempt: CommandAttempt) => { stderr: string } | undefined) | undefined
  runAnswers?: ((attempt: CommandAttempt) => string | undefined) | undefined
  gitFails?: ((attempt: GitAttempt) => { stderr: string } | undefined) | undefined
  gitAnswers?: ((attempt: GitAttempt) => string | undefined) | undefined
}) => {
  const env: Record<string, string | undefined> = args.env ?? {}
  const contents = new Map(Object.entries(args.contents ?? {}))
  for (const path of args.present ?? []) {
    if (!contents.has(path)) contents.set(path, '')
  }
  const commands: CommandAttempt[] = []
  const gitAttempts: GitAttempt[] = []

  const files: WorkspaceFiles = {
    exists: async (path) => contents.has(path),
    read: async (path) => {
      const text = contents.get(path)
      if (text === undefined) throw new Error(`no such file: ${path}`)
      return text
    },
    write: async ({ path, text }) => void contents.set(path, text),
    writeBytes: async ({ path, bytes }) => void contents.set(path, bytes.toString('utf8')),
    empty: async () => undefined,
  }

  const run: CommandRunner = async (attempt) => {
    commands.push(attempt)
    const failure = args.runFails?.(attempt)
    if (failure !== undefined) return { ok: false, stdout: '', stderr: failure.stderr }
    return { ok: true, stdout: args.runAnswers?.(attempt) ?? '', stderr: '' }
  }

  const git: GitRunner = async (attempt) => {
    gitAttempts.push(attempt)
    const failure = args.gitFails?.(attempt)
    if (failure !== undefined) return { ok: false, stdout: '', stderr: failure.stderr }
    return { ok: true, stdout: args.gitAnswers?.(attempt) ?? '', stderr: '' }
  }

  const apply = createEnvironmentProfile({ env, files, run, git, home: HOME })
  return { env, contents, commands, gitAttempts, apply }
}

const outcomeOf = (profile: EnvironmentProfile, step: EProfileStep): ProfileStepOutcome => {
  const outcome = profile.steps.find((one) => one.step === step)
  if (outcome === undefined) throw new Error(`no outcome recorded for ${step}`)
  return outcome
}

const seededScan = (attempt: CommandAttempt): string | undefined =>
  attempt.command[0] === 'ssh-keyscan' ? KEYSCAN_OUTPUT : undefined

describe('environment profile credentials', () => {
  it('arms the credential env from the spec token and probes it back', async () => {
    const { apply, env } = harness({})

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.Credentials).state).toBe(EProfileStepState.Applied)
    expect(env.GH_TOKEN).toBe(TOKEN)
    expect(env.GIT_CONFIG_COUNT).toBeDefined()
    expect(profile.capabilities.canPush).toBe(true)
  })

  it('accepts an environment that was already armed with the same token', async () => {
    const { apply } = harness({ env: { GH_TOKEN: TOKEN, GIT_CONFIG_COUNT: '7' } })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.Credentials).state).toBe(EProfileStepState.Applied)
    expect(profile.capabilities.canPush).toBe(true)
  })

  it('skips when the spec carries no token and reports it cannot push', async () => {
    const { apply, env } = harness({})

    const profile = await apply({ cwd: CWD, spec: spec({ githubToken: null }) })

    expect(outcomeOf(profile, EProfileStep.Credentials).state).toBe(EProfileStepState.Skipped)
    expect(env.GH_TOKEN).toBeUndefined()
    expect(profile.capabilities.canPush).toBe(false)
  })
})

describe('environment profile git identity', () => {
  it('writes the identity repo-locally and probes it into the capabilities', async () => {
    const { apply, gitAttempts } = harness({ present: [`${CWD}/.git`] })

    const profile = await apply({
      cwd: CWD,
      spec: spec({ gitIdentity: { name: 'Dennis', email: 'dennis@example.com' } }),
    })

    expect(outcomeOf(profile, EProfileStep.GitIdentity).state).toBe(EProfileStepState.Applied)
    expect(gitAttempts.map((attempt) => [...attempt.args])).toEqual([
      ['config', 'user.name', 'Dennis'],
      ['config', 'user.email', 'dennis@example.com'],
      ['config', 'user.name'],
      ['config', 'user.email'],
    ])
    expect(gitAttempts.every((attempt) => attempt.cwd === CWD)).toBe(true)
    expect(profile.capabilities.gitIdentity).toBe('Dennis <dennis@example.com>')
  })

  it('skips the identity when the workspace is not a git repository', async () => {
    const { apply, gitAttempts } = harness({})

    const profile = await apply({
      cwd: CWD,
      spec: spec({ gitIdentity: { name: 'Dennis', email: 'dennis@example.com' } }),
    })

    const outcome = outcomeOf(profile, EProfileStep.GitIdentity)
    expect(outcome.state).toBe(EProfileStepState.Skipped)
    expect(outcome.detail).toBeDefined()
    expect(gitAttempts).toEqual([])
    expect(profile.capabilities.gitIdentity).toBeNull()
  })

  it('skips the identity when the spec carries none', async () => {
    const { apply, gitAttempts } = harness({ present: [`${CWD}/.git`] })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.GitIdentity).state).toBe(EProfileStepState.Skipped)
    expect(gitAttempts).toEqual([])
  })
})

describe('environment profile known hosts', () => {
  it('seeds known_hosts from the keyscan output', async () => {
    const { apply, contents } = harness({ runAnswers: seededScan })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.KnownHosts).state).toBe(EProfileStepState.Applied)
    expect(contents.get(KNOWN_HOSTS)).toBe(KEYSCAN_OUTPUT)
  })

  it('appends to an existing known_hosts that lacks github.com', async () => {
    const { apply, contents } = harness({
      contents: { [KNOWN_HOSTS]: 'example.com ssh-rsa AAAAOther' },
      runAnswers: seededScan,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.KnownHosts).state).toBe(EProfileStepState.Applied)
    expect(contents.get(KNOWN_HOSTS)).toBe(`example.com ssh-rsa AAAAOther\n${KEYSCAN_OUTPUT}`)
  })

  it('skips the scan when github.com is already seeded', async () => {
    const { apply, commands } = harness({
      contents: { [KNOWN_HOSTS]: KEYSCAN_OUTPUT },
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.KnownHosts).state).toBe(EProfileStepState.Skipped)
    expect(commands).toEqual([])
  })

  it('fails with the trimmed stderr when the keyscan fails', async () => {
    const { apply } = harness({
      runFails: (attempt) =>
        attempt.command[0] === 'ssh-keyscan' ? { stderr: 'no route to host\n' } : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    const outcome = outcomeOf(profile, EProfileStep.KnownHosts)
    expect(outcome.state).toBe(EProfileStepState.Failed)
    expect(outcome.detail).toBe('no route to host')
    expect(profile.capabilities.failures).toEqual(['known-hosts: no route to host'])
  })
})

describe('environment profile toolchain', () => {
  it('runs mise, the repo hook and bun install in order for a fully-triggered repo', async () => {
    const { apply, commands } = harness({
      present: [`${CWD}/.mise.toml`, `${CWD}/.atlas/sandbox-setup.sh`, `${CWD}/bun.lock`],
      runAnswers: seededScan,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.Toolchain).state).toBe(EProfileStepState.Applied)
    expect(
      commands
        .filter((attempt) => attempt.command[0] !== 'ssh-keyscan')
        .map((attempt) => [...attempt.command]),
    ).toEqual([['mise', 'install'], ['sh', '.atlas/sandbox-setup.sh'], ['bun', 'install']])
    expect(commands.every((attempt) => attempt.cwd === CWD)).toBe(true)
  })

  it('skips an empty directory', async () => {
    const { apply, commands } = harness({ runAnswers: seededScan })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.Toolchain).state).toBe(EProfileStepState.Skipped)
    expect(commands.some((attempt) => attempt.command[0] !== 'ssh-keyscan')).toBe(false)
  })

  it('reports a failing sub-step with its command and trimmed stderr', async () => {
    const { apply } = harness({
      present: [`${CWD}/bun.lock`],
      runAnswers: seededScan,
      runFails: (attempt) =>
        attempt.command[0] === 'bun' ? { stderr: 'lockfile mismatch\n' } : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    const outcome = outcomeOf(profile, EProfileStep.Toolchain)
    expect(outcome.state).toBe(EProfileStepState.Failed)
    expect(outcome.detail).toBe('bun install: lockfile mismatch')
  })
})

describe('environment profile as a whole', () => {
  it('never lets the spec token leak into an outcome detail', async () => {
    const { apply } = harness({
      runFails: (attempt) =>
        attempt.command[0] === 'ssh-keyscan'
          ? { stderr: `dial failed for ${TOKEN} with ${TOKEN}` }
          : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.KnownHosts).state).toBe(EProfileStepState.Failed)
    expect(JSON.stringify(profile)).not.toContain(TOKEN)
    expect(JSON.stringify(profile)).toContain('***')
  })

  it('reports the full capabilities shape when every step applies', async () => {
    const { apply } = harness({
      present: [`${CWD}/.git`, `${CWD}/bun.lock`],
      runAnswers: seededScan,
    })

    const profile = await apply({
      cwd: CWD,
      spec: spec({ gitIdentity: { name: 'Dennis', email: 'dennis@example.com' } }),
    })

    expect(profile.capabilities).toEqual({
      canPush: true,
      gitIdentity: 'Dennis <dennis@example.com>',
      gpgSigning: false,
      dockerAvailable: false,
      persistentFs: true,
      serviceTtlSeconds: null,
      portExposure: EPortExposure.PublicDomain,
      failures: [],
    })
  })
})
