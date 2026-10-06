import { describe, expect, it } from 'bun:test'

import type { GpgKeyMaterial } from '@dltech/atlas-harness'

import { EProfileStep, EProfileStepState } from '../environment-profile'

import { CWD, harness, outcomeOf, seededScan, spec } from './environment-profile-fixture'

const MATERIAL: GpgKeyMaterial = {
  keyId: 'ABCD1234',
  publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----pub',
  secretKey: '-----BEGIN PGP PRIVATE KEY BLOCK-----sec',
  ownerTrust: 'ABCD1234:6:',
  sign: true,
}

const IDENTITY = { name: 'Dennis', email: 'dennis@example.com' }
const LOCK_STDERR = "error: could not lock config file .git/config: File exists"

const fullSpec = () => spec({ gitIdentity: IDENTITY, gpgKey: JSON.stringify(MATERIAL) })

const isConfigWrite = (event: string): boolean => /^git config \S+ \S/.test(event)

describe('environment profile git config scheduling', () => {
  it('never lets two repo config writers overlap across identity, signing and setup', async () => {
    const { apply, stats } = harness({
      present: [`${CWD}/.git`, `${CWD}/bun.lock`, `${CWD}/.atlas/sandbox-setup.sh`],
      runAnswers: seededScan,
      gitConfigDelayMs: 5,
    })

    const profile = await apply({ cwd: CWD, spec: fullSpec() })

    expect(profile.capabilities.failures).toEqual([])
    expect(stats.maxConfigWriters).toBe(1)
    expect(outcomeOf(profile, EProfileStep.GitIdentity).state).toBe(EProfileStepState.Applied)
    expect(outcomeOf(profile, EProfileStep.GpgSigning).state).toBe(EProfileStepState.Applied)
  })

  it('starts the toolchain setup only after the git profile chain finished', async () => {
    const { apply, events } = harness({
      present: [`${CWD}/.git`, `${CWD}/bun.lock`, `${CWD}/.atlas/sandbox-setup.sh`],
      runAnswers: seededScan,
    })

    await apply({ cwd: CWD, spec: fullSpec() })

    const verified = events.findIndex((event) => event.startsWith('git verify-commit'))
    const setup = events.findIndex((event) => event === 'sh .atlas/sandbox-setup.sh')
    expect(verified).toBeGreaterThan(-1)
    expect(setup).toBeGreaterThan(verified)
    expect(events.lastIndexOf('git config user.email')).toBeLessThan(
      events.findIndex((event) => event.startsWith('git config user.signingkey')),
    )
  })

  it('keeps the recorded step order stable', async () => {
    const { apply } = harness({ present: [`${CWD}/.git`], runAnswers: seededScan })

    const profile = await apply({ cwd: CWD, spec: fullSpec() })

    expect(profile.steps.map((one) => one.step)).toEqual([
      EProfileStep.Credentials,
      EProfileStep.GitIdentity,
      EProfileStep.KnownHosts,
      EProfileStep.Toolchain,
      EProfileStep.GpgSigning,
    ])
  })

  it('stops writing identity after the first failed write', async () => {
    const { apply, events } = harness({
      present: [`${CWD}/.git`],
      runAnswers: seededScan,
      gitFails: (attempt) =>
        attempt.args[1] === 'user.name' && attempt.args[2] !== undefined
          ? { stderr: 'boom\n' }
          : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: spec({ gitIdentity: IDENTITY }) })

    const outcome = outcomeOf(profile, EProfileStep.GitIdentity)
    expect(outcome.state).toBe(EProfileStepState.Failed)
    expect(outcome.detail).toBe('boom')
    expect(events.filter((event) => event.startsWith('git config'))).toEqual([
      'git config user.name Dennis',
    ])
    expect(profile.capabilities.gitIdentity).toBeNull()
  })

  it('fails when the effective identity differs from the requested one', async () => {
    const { apply } = harness({
      present: [`${CWD}/.git`],
      runAnswers: seededScan,
      gitAnswers: (attempt) =>
        attempt.args.join(' ') === 'config user.email' ? 'someone-else@example.com\n' : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: spec({ gitIdentity: IDENTITY }) })

    const outcome = outcomeOf(profile, EProfileStep.GitIdentity)
    expect(outcome.state).toBe(EProfileStepState.Failed)
    expect(outcome.detail).toContain('user.email')
    expect(profile.capabilities.gitIdentity).toBeNull()
  })

  it('trims the effective readback before comparing', async () => {
    const { apply } = harness({ present: [`${CWD}/.git`], runAnswers: seededScan })

    const profile = await apply({ cwd: CWD, spec: spec({ gitIdentity: IDENTITY }) })

    expect(profile.capabilities.gitIdentity).toBe('Dennis <dennis@example.com>')
  })
})

describe('environment profile config lock handling', () => {
  it('reports a held config lock as a failure and leaves it alone without retrying', async () => {
    const lock = `${CWD}/.git/config.lock`
    const { apply, events, contents, commands } = harness({
      present: [`${CWD}/.git`, lock],
      runAnswers: seededScan,
      gitFails: (attempt) => (attempt.args[0] === 'config' ? { stderr: LOCK_STDERR } : undefined),
    })

    const profile = await apply({ cwd: CWD, spec: fullSpec() })

    const identity = outcomeOf(profile, EProfileStep.GitIdentity)
    expect(identity.state).toBe(EProfileStepState.Failed)
    expect(identity.detail).toContain('could not lock config file')
    expect(outcomeOf(profile, EProfileStep.GpgSigning).state).toBe(EProfileStepState.Failed)
    expect(contents.has(lock)).toBe(true)
    expect(events.filter(isConfigWrite).length).toBe(2)
    expect(commands.some((one) => one.command[0] === 'rm')).toBe(false)
  })
})
