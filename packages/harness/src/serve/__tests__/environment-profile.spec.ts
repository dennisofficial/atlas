import { describe, expect, it } from 'bun:test'

import { EProfileStep, EProfileStepState } from '../environment-profile'

import {
  CWD,
  harness,
  KEYSCAN_OUTPUT,
  KNOWN_HOSTS,
  outcomeOf,
  seededScan,
  spec,
  TOKEN,
} from './environment-profile-fixture'

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
    expect(commands.filter((attempt) => attempt.command[0] !== 'docker')).toEqual([])
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
        .filter((attempt) => attempt.command[0] !== 'ssh-keyscan' && attempt.command[0] !== 'docker')
        .map((attempt) => [...attempt.command]),
    ).toEqual([['mise', 'install'], ['sh', '.atlas/sandbox-setup.sh'], ['bun', 'install']])
    expect(commands.every((attempt) => attempt.cwd === CWD)).toBe(true)
  })

  it('skips an empty directory', async () => {
    const { apply, commands } = harness({ runAnswers: seededScan })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(outcomeOf(profile, EProfileStep.Toolchain).state).toBe(EProfileStepState.Skipped)
    expect(
      commands.some(
        (attempt) => attempt.command[0] !== 'ssh-keyscan' && attempt.command[0] !== 'docker',
      ),
    ).toBe(false)
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
