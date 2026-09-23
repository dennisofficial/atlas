import { describe, expect, it } from 'bun:test'

import type { GpgKeyMaterial } from '../../workspace/gpg-material'
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

const MATERIAL: GpgKeyMaterial = {
  keyId: 'ABCD1234',
  publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----pub',
  secretKey: '-----BEGIN PGP PRIVATE KEY BLOCK-----sec',
  ownerTrust: 'ABCD1234:6:',
  sign: true,
}

const spec = (partial: Partial<WorkspaceSpec> = {}): WorkspaceSpec => ({
  remoteUrl: 'git@github.com:dennisofficial/atlas.git',
  branch: 'main',
  commit: null,
  patch: '',
  githubToken: null,
  contextBundle: null,
  gpgKey: JSON.stringify(MATERIAL),
  ...partial,
})

type CommandAttempt = { command: readonly string[]; cwd: string; stdin?: string | undefined }
type GitAttempt = { args: readonly string[]; cwd: string }

const harness = (args: {
  present?: readonly string[] | undefined
  runFails?: ((attempt: CommandAttempt) => { stderr: string } | undefined) | undefined
  gitFails?: ((attempt: GitAttempt) => { stderr: string } | undefined) | undefined
}) => {
  const contents = new Map<string, string>()
  for (const path of args.present ?? []) contents.set(path, '')
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
    return { ok: true, stdout: '', stderr: '' }
  }

  const git: GitRunner = async (attempt) => {
    gitAttempts.push(attempt)
    const failure = args.gitFails?.(attempt)
    if (failure !== undefined) return { ok: false, stdout: '', stderr: failure.stderr }
    return { ok: true, stdout: '', stderr: '' }
  }

  const apply = createEnvironmentProfile({ env: {}, files, run, git, home: HOME })
  return { commands, gitAttempts, apply }
}

const outcomeOf = (profile: EnvironmentProfile, step: EProfileStep): ProfileStepOutcome => {
  const outcome = profile.steps.find((one) => one.step === step)
  if (outcome === undefined) throw new Error(`no outcome recorded for ${step}`)
  return outcome
}

const gpgOutcome = (profile: EnvironmentProfile): ProfileStepOutcome =>
  outcomeOf(profile, EProfileStep.GpgSigning)

describe('environment profile gpg signing', () => {
  it('imports the material over stdin, seeds ownertrust and sets repo-local signing config', async () => {
    const { apply, commands, gitAttempts } = harness({ present: [`${CWD}/.git`] })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Applied)
    const imported = commands.find((attempt) => attempt.command.includes('--import'))
    expect(imported?.stdin).toBe(`${MATERIAL.secretKey}\n${MATERIAL.publicKey}`)
    const trusted = commands.find((attempt) => attempt.command.includes('--import-ownertrust'))
    expect(trusted?.stdin).toBe(MATERIAL.ownerTrust)
    expect(gitAttempts.map((attempt) => [...attempt.args])).toEqual([
      ['config', 'user.signingkey', MATERIAL.keyId],
      ['config', 'commit.gpgsign', 'true'],
    ])
    expect(gitAttempts.every((attempt) => attempt.cwd === CWD)).toBe(true)
  })

  it('writes commit.gpgsign false when the bundle says not to sign', async () => {
    const { apply, gitAttempts } = harness({ present: [`${CWD}/.git`] })

    await apply({ cwd: CWD, spec: spec({ gpgKey: JSON.stringify({ ...MATERIAL, sign: false }) }) })

    expect(gitAttempts.map((attempt) => [...attempt.args])).toContainEqual([
      'config',
      'commit.gpgsign',
      'false',
    ])
  })

  it('skips the ownertrust import when the bundle carries none', async () => {
    const { apply, commands } = harness({ present: [`${CWD}/.git`] })

    const profile = await apply({
      cwd: CWD,
      spec: spec({ gpgKey: JSON.stringify({ ...MATERIAL, ownerTrust: '' }) }),
    })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Applied)
    expect(commands.some((attempt) => attempt.command.includes('--import-ownertrust'))).toBe(false)
  })

  it('gates the capability on the secret-key probe', async () => {
    const { apply, commands } = harness({ present: [`${CWD}/.git`] })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(profile.capabilities.gpgSigning).toBe(true)
    const probe = commands.find((attempt) => attempt.command.includes('--list-secret-keys'))
    expect(probe?.command).toEqual(['gpg', '--batch', '--list-secret-keys', MATERIAL.keyId])
  })

  it('fails when the probe cannot see the secret key', async () => {
    const { apply } = harness({
      present: [`${CWD}/.git`],
      runFails: (attempt) =>
        attempt.command.includes('--list-secret-keys') ? { stderr: 'no secret key\n' } : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Failed)
    expect(gpgOutcome(profile).detail).toBe('no secret key')
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('skips when the spec carries no gpg key and reports no signing capability', async () => {
    const { apply, commands } = harness({ present: [`${CWD}/.git`] })

    const profile = await apply({ cwd: CWD, spec: spec({ gpgKey: null }) })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Skipped)
    expect(commands.some((attempt) => attempt.command[0] === 'gpg')).toBe(false)
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('fails when the material does not parse', async () => {
    const { apply } = harness({ present: [`${CWD}/.git`] })

    const profile = await apply({ cwd: CWD, spec: spec({ gpgKey: '{not json' }) })

    const outcome = gpgOutcome(profile)
    expect(outcome.state).toBe(EProfileStepState.Failed)
    expect(outcome.detail).toBe('the gpg material did not parse')
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('fails naming the issue when the material fails validation', async () => {
    const { apply } = harness({ present: [`${CWD}/.git`] })

    const profile = await apply({
      cwd: CWD,
      spec: spec({ gpgKey: JSON.stringify({ ...MATERIAL, keyId: '' }) }),
    })

    const outcome = gpgOutcome(profile)
    expect(outcome.state).toBe(EProfileStepState.Failed)
    expect(outcome.detail).toContain('the gpg material is invalid')
    expect(outcome.detail).toContain('keyId')
  })

  it('skips with detail when the workspace is not a git repository', async () => {
    const { apply, commands, gitAttempts } = harness({})

    const profile = await apply({ cwd: CWD, spec: spec() })

    const outcome = gpgOutcome(profile)
    expect(outcome.state).toBe(EProfileStepState.Skipped)
    expect(outcome.detail).toBe('the workspace is not a git repository')
    expect(commands.some((attempt) => attempt.command[0] === 'gpg')).toBe(false)
    expect(gitAttempts).toEqual([])
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('fails with the trimmed stderr when the import fails', async () => {
    const { apply } = harness({
      present: [`${CWD}/.git`],
      runFails: (attempt) =>
        attempt.command.includes('--import') && !attempt.command.includes('--import-ownertrust')
          ? { stderr: 'no valid OpenPGP data found\n' }
          : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    const outcome = gpgOutcome(profile)
    expect(outcome.state).toBe(EProfileStepState.Failed)
    expect(outcome.detail).toBe('no valid OpenPGP data found')
    expect(profile.capabilities.gpgSigning).toBe(false)
  })

  it('never lets the secret material leak into a recorded detail', async () => {
    const { apply } = harness({
      present: [`${CWD}/.git`],
      runFails: (attempt) =>
        attempt.command.includes('--import')
          ? {
              stderr: `gpg: key ${MATERIAL.secretKey} rejected; trust ${MATERIAL.ownerTrust}; pub ${MATERIAL.publicKey}`,
            }
          : undefined,
    })

    const profile = await apply({ cwd: CWD, spec: spec() })

    expect(gpgOutcome(profile).state).toBe(EProfileStepState.Failed)
    const recorded = JSON.stringify(profile)
    expect(recorded).not.toContain(MATERIAL.secretKey)
    expect(recorded).not.toContain(MATERIAL.publicKey)
    expect(recorded).not.toContain(MATERIAL.ownerTrust)
    expect(recorded).toContain('***')
  })
})
