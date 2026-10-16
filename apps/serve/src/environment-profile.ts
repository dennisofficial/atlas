import { homedir } from 'node:os'
import { join } from 'node:path'

import { EPortExposure, type EnvironmentCapabilities } from '@dltech/atlas-core'

import { applyGitAccessEnv } from './git-access-env'
import { runCommand, type CommandRunner } from './run-command'
import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'
import type { WorkspaceSpec } from './workspace-spec'

export enum EProfileStep {
  Credentials = 'credentials',
  KnownHosts = 'known-hosts',
  Toolchain = 'toolchain',
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

const MISE_CONFIGS = ['.mise.toml', 'mise.toml', '.tool-versions'] as const
const SETUP_HOOK = '.atlas/sandbox-setup.sh'
// Bounded so a wedged dockerd answers "no" fast instead of stalling session boot; the shimmed
// `docker` on the sandbox image starts the baked daemon on this very call when none is running.
const DOCKER_PROBE_TIMEOUT_MS = 30_000
// Cold microVM dockerd startups exceed any budget the boot profile can afford, so an unanswered
// probe reports docker unavailable and the daemon finishes booting in the background; the shim
// execs the real binary on first use.
const DOCKER_PROBE_BUDGET_MS = 3_000

const probeDocker = async (run: CommandRunner, cwd: string): Promise<boolean> => {
  const probe = run({ command: ['docker', 'info'], cwd })
    .then((outcome) => outcome.ok)
    .catch(() => false)
  const answered = await Promise.race([
    probe.then((available) => ({ answered: true, available })),
    new Promise<{ answered: false; available: false }>((resolve) => {
      setTimeout(() => resolve({ answered: false, available: false }), DOCKER_PROBE_BUDGET_MS)
    }),
  ])
  if (answered.answered) return answered.available
  void Promise.race([
    probe,
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), DOCKER_PROBE_TIMEOUT_MS)
    }),
  ]).then(() => undefined, () => undefined)
  return false
}

export function createEnvironmentProfile(args: {
  env: Record<string, string | undefined>
  files?: WorkspaceFiles | undefined
  run?: CommandRunner | undefined
  home?: string | undefined
  serviceTtlSeconds?: number | undefined
}): ApplyEnvironmentProfile {
  const env = args.env
  const files = args.files ?? nodeWorkspaceFiles
  const run = args.run ?? runCommand
  const home = args.home ?? env.HOME ?? homedir()

  return async ({ cwd, spec }) => {
    const token = spec.githubToken
    const scrub = (text: string): string =>
      token === null || token === '' ? text : text.split(token).join('***')

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
        if (!mise && !hook) {
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
        if (failures.length > 0) {
          return {
            step: EProfileStep.Toolchain,
            state: EProfileStepState.Failed,
            detail: failures.join('; '),
          }
        }
        return { step: EProfileStep.Toolchain, state: EProfileStepState.Applied }
      })

    const [credentialsOutcome, knownHostsOutcome, toolchainOutcome, dockerAvailable] =
      await Promise.all([credentials(), knownHosts(), toolchain(), probeDocker(run, cwd)])
    const steps = [credentialsOutcome, knownHostsOutcome, toolchainOutcome] as const
    const capabilities: EnvironmentCapabilities = {
      canPush: credentialsOutcome.state === EProfileStepState.Applied,
      gitIdentity: null,
      gpgSigning: false,
      dockerAvailable,
      persistentFs: true,
      serviceTtlSeconds: args.serviceTtlSeconds ?? null,
      portExposure: EPortExposure.PublicDomain,
      failures: steps
        .filter((one) => one.state === EProfileStepState.Failed)
        .map((one) => `${one.step}: ${one.detail ?? 'it failed for a reason it did not name'}`),
    }

    return { steps, capabilities }
  }
}
