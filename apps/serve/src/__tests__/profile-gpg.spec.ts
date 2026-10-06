import { describe, expect, it } from 'bun:test'

import type { GpgKeyMaterial } from '@dltech/atlas-harness'

import {
  EProfileStep,
  EProfileStepState,
  type EnvironmentProfile,
  type ProfileStepOutcome,
} from '../environment-profile'
import type { WorkspaceSpec } from '../workspace-spec'

import { COMMIT_ID, CWD, harness, outcomeOf, spec, TREE_ID } from './environment-profile-fixture'

const MATERIAL: GpgKeyMaterial = {
  keyId: 'ABCD1234',
  publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----pub',
  secretKey: '-----BEGIN PGP PRIVATE KEY BLOCK-----sec',
  ownerTrust: 'ABCD1234:6:',
  sign: true,
}

const gpgSpec = (partial: Partial<WorkspaceSpec> = {}): WorkspaceSpec =>
  spec({ githubToken: null, gpgKey: JSON.stringify(MATERIAL), ...partial })

const gpgOutcome = (profile: EnvironmentProfile): ProfileStepOutcome =>
  outcomeOf(profile, EProfileStep.GpgSigning)

const present = [`${CWD}/.git`]

describe('environment profile gpg signing', () => {
  it('imports the material over stdin and seeds ownertrust', async () => {
    const { apply, commands } = harness({ present })

    const profile = await apply({ cwd: CWD, spec: gpgSpec() })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Applied)
    const imported = commands.find((attempt) => attempt.command.includes('--import'))
    expect(imported?.stdin).toBe(`${MATERIAL.secretKey}\n${MATERIAL.publicKey}`)
    const trusted = commands.find((attempt) => attempt.command.includes('--import-ownertrust'))
    expect(trusted?.stdin).toBe(MATERIAL.ownerTrust)
  })

  it('sets explicit openpgp signing config sequentially and reads it back', async () => {
    const { apply, gitConfig, events } = harness({ present })

    await apply({ cwd: CWD, spec: gpgSpec() })

    expect(Object.fromEntries(gitConfig)).toEqual({
      'user.signingkey': MATERIAL.keyId,
      'commit.gpgsign': 'true',
      'gpg.format': 'openpgp',
      'gpg.program': 'gpg',
    })
    const writes = events.filter((event) => /^git config \S+ \S/.test(event))
    expect(writes).toEqual([
      `git config user.signingkey ${MATERIAL.keyId}`,
      'git config commit.gpgsign true',
      'git config gpg.format openpgp',
      'git config gpg.program gpg',
    ])
  })

  it('keeps commit.gpgsign false when the bundle says not to sign', async () => {
    const { apply, gitConfig } = harness({ present })

    const profile = await apply({
      cwd: CWD,
      spec: gpgSpec({ gpgKey: JSON.stringify({ ...MATERIAL, sign: false }) }),
    })

    expect(gitConfig.get('commit.gpgsign')).toBe('false')
    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Applied)
  })

  it('skips the ownertrust import when the bundle carries none', async () => {
    const { apply, commands } = harness({ present })

    const profile = await apply({
      cwd: CWD,
      spec: gpgSpec({ gpgKey: JSON.stringify({ ...MATERIAL, ownerTrust: '' }) }),
    })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Applied)
    expect(commands.some((attempt) => attempt.command.includes('--import-ownertrust'))).toBe(false)
  })

  it('gates the capability on an actual sign and verify of an unreferenced commit', async () => {
    const { apply, commands, gitAttempts } = harness({ present })

    const profile = await apply({ cwd: CWD, spec: gpgSpec() })

    expect(profile.capabilities.gpgSigning).toBe(true)
    const mktree = commands.find((attempt) => attempt.command.join(' ') === 'git mktree')
    expect(mktree?.stdin).toBe('')
    const commitTree = gitAttempts.find((attempt) => attempt.args[0] === 'commit-tree')
    expect(commitTree?.args).toEqual([
      'commit-tree',
      TREE_ID,
      '-S',
      '-m',
      'atlas signing probe',
    ])
    const verify = gitAttempts.find((attempt) => attempt.args[0] === 'verify-commit')
    expect(verify?.args).toEqual(['verify-commit', COMMIT_ID])
    const mutating = gitAttempts.filter((attempt) =>
      ['commit', 'update-ref', 'add', 'checkout', 'reset'].includes(attempt.args[0] ?? ''),
    )
    expect(mutating).toEqual([])
    expect(commands.some((attempt) => attempt.command.includes('--list-secret-keys'))).toBe(false)
  })

  it('reports signing unavailable when the commit cannot be signed', async () => {
    const { apply } = harness({
      present,
      gitFails: (attempt) =>
        attempt.args[0] === 'commit-tree' ? { stderr: 'gpg failed to sign the data\n' } : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: gpgSpec() })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Failed)
    expect(gpgOutcome(profile).detail).toBe('gpg failed to sign the data')
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('reports signing unavailable when the signature does not verify', async () => {
    const { apply } = harness({
      present,
      gitFails: (attempt) =>
        attempt.args[0] === 'verify-commit' ? { stderr: 'BAD signature\n' } : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: gpgSpec() })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Failed)
    expect(gpgOutcome(profile).detail).toBe('BAD signature')
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('refuses an empty tree or commit id instead of passing it on as an argument', async () => {
    const emptyTree = harness({
      present,
      runAnswers: (attempt) => (attempt.command[0] === 'git' ? '\n' : undefined),
    })
    const emptyCommit = harness({
      present,
      gitAnswers: (attempt) => (attempt.args[0] === 'commit-tree' ? '\n' : undefined),
    })

    const treeProfile = await emptyTree.apply({ cwd: CWD, spec: gpgSpec() })
    const commitProfile = await emptyCommit.apply({ cwd: CWD, spec: gpgSpec() })

    expect(treeProfile.capabilities.gpgSigning).toBe(false)
    expect(commitProfile.capabilities.gpgSigning).toBe(false)
    expect(emptyTree.gitAttempts.some((attempt) => attempt.args[0] === 'commit-tree')).toBe(false)
    expect(emptyCommit.gitAttempts.some((attempt) => attempt.args[0] === 'verify-commit')).toBe(false)
  })

  it('stops after the first failed signing config write', async () => {
    const { apply, events } = harness({
      present,
      gitFails: (attempt) =>
        attempt.args[1] === 'commit.gpgsign' ? { stderr: 'locked\n' } : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: gpgSpec() })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Failed)
    expect(events.some((event) => event.startsWith('git config gpg.format'))).toBe(false)
    expect(events.some((event) => event.startsWith('git commit-tree'))).toBe(false)
  })

  it('skips when the spec carries no gpg key and reports no signing capability', async () => {
    const { apply, commands } = harness({ present })

    const profile = await apply({ cwd: CWD, spec: gpgSpec({ gpgKey: null }) })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Skipped)
    expect(commands.some((attempt) => attempt.command[0] === 'gpg')).toBe(false)
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('fails when the material does not parse', async () => {
    const { apply } = harness({ present })

    const profile = await apply({ cwd: CWD, spec: gpgSpec({ gpgKey: '{not json' }) })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Failed)
    expect(gpgOutcome(profile).detail).toBe('the gpg material did not parse')
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('fails naming the issue when the material fails validation', async () => {
    const { apply } = harness({ present })

    const profile = await apply({
      cwd: CWD,
      spec: gpgSpec({ gpgKey: JSON.stringify({ ...MATERIAL, keyId: '' }) }),
    })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Failed)
    expect(gpgOutcome(profile).detail).toContain('the gpg material is invalid')
    expect(gpgOutcome(profile).detail).toContain('keyId')
  })

  it('skips with detail when the workspace is not a git repository', async () => {
    const { apply, commands, gitAttempts } = harness({})

    const profile = await apply({ cwd: CWD, spec: gpgSpec() })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Skipped)
    expect(gpgOutcome(profile).detail).toBe('the workspace is not a git repository')
    expect(commands.some((attempt) => attempt.command[0] === 'gpg')).toBe(false)
    expect(gitAttempts).toEqual([])
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('fails with the trimmed stderr when the import fails', async () => {
    const { apply } = harness({
      present,
      runFails: (attempt) =>
        attempt.command.includes('--import') && !attempt.command.includes('--import-ownertrust')
          ? { stderr: 'no valid OpenPGP data found\n' }
          : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: gpgSpec() })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Failed)
    expect(gpgOutcome(profile).detail).toBe('no valid OpenPGP data found')
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('never lets the secret material leak into a recorded detail', async () => {
    const leak = `gpg: key ${MATERIAL.secretKey} rejected; trust ${MATERIAL.ownerTrust}; pub ${MATERIAL.publicKey}`
    const { apply } = harness({
      present,
      runFails: (attempt) => (attempt.command.includes('--import') ? { stderr: leak } : undefined),
    })
    const signing = harness({
      present,
      gitFails: (attempt) => (attempt.args[0] === 'verify-commit' ? { stderr: leak } : undefined),
    })

    const imported = await apply({ cwd: CWD, spec: gpgSpec() })
    const verified = await signing.apply({ cwd: CWD, spec: gpgSpec() })

    for (const profile of [imported, verified]) {
      expect(gpgOutcome(profile).state).toBe(EProfileStepState.Failed)
      const recorded = JSON.stringify(profile)
      expect(recorded).not.toContain(MATERIAL.secretKey)
      expect(recorded).not.toContain(MATERIAL.publicKey)
      expect(recorded).not.toContain(MATERIAL.ownerTrust)
      expect(recorded).toContain('***')
    }
  })
})
