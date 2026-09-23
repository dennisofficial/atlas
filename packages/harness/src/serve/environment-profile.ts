import { homedir } from 'node:os'
import { join } from 'node:path'

import { EPortExposure, type EnvironmentCapabilities } from '@dltech/atlas-core'

import { runGit } from '../workspace/run-git'

import { applyGitAccessEnv } from './git-access-env'
import type { GitRunner } from './materialize-workspace'
import { createGpgSigningStep } from './profile-gpg'
import { runCommand, type CommandRunner } from './run-command'
import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'
import type { WorkspaceSpec } from './workspace-spec'

export enum EProfileStep {
  Credentials = 'credentials',
  GitIdentity = 'git-identity',
  KnownHosts = 'known-hosts',
  Toolchain = 'toolchain',
  GpgSigning = 'gpg-signing',
}

export enum EProfileStepState {
  Applied = 'applied',
  Skipped = 'skipped',
  Failed = 'failed',
}

export type ProfileStepOutcome = {
  step: EProfileStep
  state: EProfileStepState
  detail?: string | undefined
}

export type EnvironmentProfile = {
  steps: readonly ProfileStepOutcome[]
  capabilities: EnvironmentCapabilities
}

export type ApplyEnvironmentProfile = (args: {
  cwd: string
  spec: WorkspaceSpec
}) => Promise<EnvironmentProfile>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const gpgSecrets = (raw: string | null | undefined): string[] => {
  if (raw === null || raw === undefined) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return []
    const record = parsed as Record<string, unknown>
    return [record.secretKey, record.publicKey, record.ownerTrust].filter(
      (value): value is string => typeof value === 'string' && value !== '',
    )
  } catch {
    return []
  }
}

const MISE_CONFIGS = ['.mise.toml', 'mise.toml', '.tool-versions'] as const
const BUN_LOCKFILES = ['bun.lock', 'bun.lockb'] as const
const SETUP_HOOK = '.atlas/sandbox-setup.sh'

export function createEnvironmentProfile(args: {
  env: Record<string, string | undefined>
  files?: WorkspaceFiles | undefined
  run?: CommandRunner | undefined
  git?: GitRunner | undefined
  home?: string | undefined
}): ApplyEnvironmentProfile {
  const env = args.env
  const files = args.files ?? nodeWorkspaceFiles
  const run = args.run ?? runCommand
  const git = args.git ?? runGit
  const home = args.home ?? env.HOME ?? homedir()

  const gpg = createGpgSigningStep({ files, run, git })

  return async ({ cwd, spec }) => {
    const token = spec.githubToken
    const scrub = (text: string): string => {
      let cleaned = token === null || token === '' ? text : text.split(token).join('***')
      for (const secret of gpgSecrets(spec.gpgKey)) {
        cleaned = cleaned.split(secret).join('***')
      }
      return cleaned
    }

    const guard = async (
      step: EProfileStep,
      apply: () => Promise<ProfileStepOutcome>,
    ): Promise<ProfileStepOutcome> => {
      try {
        const outcome = await apply()
        if (outcome.detail === undefined) return outcome
        return { ...outcome, detail: scrub(outcome.detail) }
      } catch (error) {
        return { step, state: EProfileStepState.Failed, detail: scrub(messageOf(error)) }
      }
    }

    const anyExists = async (names: readonly string[]): Promise<boolean> => {
      for (const name of names) {
        if (await files.exists(join(cwd, name))) return true
      }
      return false
    }

    let probedIdentity: string | null = null
    let probedGpg = false

    const gpgSigning = (): Promise<ProfileStepOutcome> =>
      guard(EProfileStep.GpgSigning, async () => {
        const result = await gpg({ cwd, spec })
        probedGpg = result.probed
        return result.outcome
      })

    const credentials = (): Promise<ProfileStepOutcome> =>
      guard(EProfileStep.Credentials, async () => {
        if (token === null || token === '') {
          return { step: EProfileStep.Credentials, state: EProfileStepState.Skipped }
        }
        if (env.GH_TOKEN !== token || env.GIT_CONFIG_COUNT === undefined) {
          applyGitAccessEnv({ env, cwd, githubToken: token })
        }
        if (env.GH_TOKEN === token && env.GIT_CONFIG_COUNT !== undefined) {
          return { step: EProfileStep.Credentials, state: EProfileStepState.Applied }
        }
        return {
          step: EProfileStep.Credentials,
          state: EProfileStepState.Failed,
          detail: 'the credential environment did not arm',
        }
      })

    const gitIdentity = (): Promise<ProfileStepOutcome> =>
      guard(EProfileStep.GitIdentity, async () => {
        const identity = spec.gitIdentity
        if (identity === null || identity === undefined) {
          return { step: EProfileStep.GitIdentity, state: EProfileStepState.Skipped }
        }
        if (!(await files.exists(join(cwd, '.git')))) {
          return {
            step: EProfileStep.GitIdentity,
            state: EProfileStepState.Skipped,
            detail: 'the workspace is not a git repository',
          }
        }
        const runs = await Promise.all([
          git({ args: ['config', 'user.name', identity.name], cwd }),
          git({ args: ['config', 'user.email', identity.email], cwd }),
        ])
        const probes = await Promise.all([
          git({ args: ['config', 'user.name'], cwd }),
          git({ args: ['config', 'user.email'], cwd }),
        ])
        const failedRun = [...runs, ...probes].find((one) => !one.ok)
        if (failedRun !== undefined) {
          return {
            step: EProfileStep.GitIdentity,
            state: EProfileStepState.Failed,
            detail: failedRun.stderr.trim(),
          }
        }
        probedIdentity = `${identity.name} <${identity.email}>`
        return { step: EProfileStep.GitIdentity, state: EProfileStepState.Applied }
      })

    const knownHosts = (): Promise<ProfileStepOutcome> =>
      guard(EProfileStep.KnownHosts, async () => {
        const path = join(home, '.ssh', 'known_hosts')
        if (await files.exists(path)) {
          const content = await files.read(path)
          if (content.includes('github.com')) {
            return {
              step: EProfileStep.KnownHosts,
              state: EProfileStepState.Skipped,
              detail: 'github.com is already seeded',
            }
          }
        }
        const scan = await run({
          command: ['ssh-keyscan', '-t', 'rsa,ecdsa,ed25519', 'github.com'],
          cwd,
        })
        if (!scan.ok || scan.stdout.trim() === '') {
          return {
            step: EProfileStep.KnownHosts,
            state: EProfileStepState.Failed,
            detail: scan.stderr.trim(),
          }
        }
        const existing = (await files.exists(path)) ? await files.read(path) : ''
        const text =
          existing.length > 0 && !existing.endsWith('\n')
            ? `${existing}\n${scan.stdout}`
            : `${existing}${scan.stdout}`
        await files.write({ path, text })
        return { step: EProfileStep.KnownHosts, state: EProfileStepState.Applied }
      })

    const toolchain = (): Promise<ProfileStepOutcome> =>
      guard(EProfileStep.Toolchain, async () => {
        const mise = await anyExists(MISE_CONFIGS)
        const hook = await files.exists(join(cwd, SETUP_HOOK))
        const lockfile = await anyExists(BUN_LOCKFILES)
        if (!mise && !hook && !lockfile) {
          return { step: EProfileStep.Toolchain, state: EProfileStepState.Skipped }
        }
        const failures: string[] = []
        const attempt = async (command: readonly string[]): Promise<void> => {
          const outcome = await run({ command, cwd })
          if (!outcome.ok) {
            failures.push(`${command.join(' ')}: ${outcome.stderr.trim().slice(0, 200)}`)
          }
        }
        if (mise) await attempt(['mise', 'install'])
        if (hook) await attempt(['sh', SETUP_HOOK])
        if (lockfile) await attempt(['bun', 'install'])
        if (failures.length > 0) {
          return {
            step: EProfileStep.Toolchain,
            state: EProfileStepState.Failed,
            detail: failures.join('; '),
          }
        }
        return { step: EProfileStep.Toolchain, state: EProfileStepState.Applied }
      })

    const steps = await Promise.all([
      credentials(),
      gitIdentity(),
      knownHosts(),
      toolchain(),
      gpgSigning(),
    ])
    const [credentialsOutcome] = steps

    const capabilities: EnvironmentCapabilities = {
      canPush: credentialsOutcome.state === EProfileStepState.Applied,
      gitIdentity: probedIdentity,
      gpgSigning: probedGpg,
      dockerAvailable: false,
      persistentFs: true,
      serviceTtlSeconds: null,
      portExposure: EPortExposure.PublicDomain,
      failures: steps
        .filter((one) => one.state === EProfileStepState.Failed)
        .map((one) => `${one.step}: ${one.detail ?? 'it failed for a reason it did not name'}`),
    }

    return { steps, capabilities }
  }
}
