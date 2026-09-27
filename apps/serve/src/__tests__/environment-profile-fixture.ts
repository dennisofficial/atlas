import {
  createEnvironmentProfile,
  EProfileStep,
  type EnvironmentProfile,
  type ProfileStepOutcome,
} from '../environment-profile'
import type { GitRunner } from '../materialize-workspace'
import type { CommandRunner } from '../run-command'
import type { WorkspaceFiles } from '../workspace-files'
import type { WorkspaceSpec } from '../workspace-spec'

export const CWD = '/workspace'
export const HOME = '/home/sandbox'
export const TOKEN = 'gho_secret-token'
export const KNOWN_HOSTS = `${HOME}/.ssh/known_hosts`
export const KEYSCAN_OUTPUT = 'github.com ssh-rsa AAAAFakeKey\n'

export const spec = (partial: Partial<WorkspaceSpec> = {}): WorkspaceSpec => ({
  remoteUrl: 'git@github.com:dennisofficial/atlas.git',
  branch: 'main',
  commit: null,
  patch: '',
  githubToken: TOKEN,
  contextBundle: null,
  ...partial,
})

export type CommandAttempt = { command: readonly string[]; cwd: string }
export type GitAttempt = { args: readonly string[]; cwd: string }

export const harness = (args: {
  contents?: Record<string, string> | undefined
  present?: readonly string[] | undefined
  env?: Record<string, string | undefined> | undefined
  runFails?: ((attempt: CommandAttempt) => { stderr: string } | undefined) | undefined
  runAnswers?: ((attempt: CommandAttempt) => string | undefined) | undefined
  gitFails?: ((attempt: GitAttempt) => { stderr: string } | undefined) | undefined
  gitAnswers?: ((attempt: GitAttempt) => string | undefined) | undefined
  serviceTtlSeconds?: number | undefined
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
    ensureDirectory: async () => undefined,
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

  const apply = createEnvironmentProfile({
    env,
    files,
    run,
    git,
    home: HOME,
    serviceTtlSeconds: args.serviceTtlSeconds,
  })
  return { env, contents, commands, gitAttempts, apply }
}

export const outcomeOf = (profile: EnvironmentProfile, step: EProfileStep): ProfileStepOutcome => {
  const outcome = profile.steps.find((one) => one.step === step)
  if (outcome === undefined) throw new Error(`no outcome recorded for ${step}`)
  return outcome
}

export const seededScan = (attempt: CommandAttempt): string | undefined =>
  attempt.command[0] === 'ssh-keyscan' ? KEYSCAN_OUTPUT : undefined
