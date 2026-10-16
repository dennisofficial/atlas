import {
  createEnvironmentProfile,
  EProfileStep,
  type EnvironmentProfile,
  type ProfileStepOutcome,
} from '../environment-profile'
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
  githubToken: TOKEN,
  ...partial,
})

export type CommandAttempt = { command: readonly string[]; cwd: string; stdin?: string | undefined }

export const harness = (args: {
  contents?: Record<string, string> | undefined
  present?: readonly string[] | undefined
  env?: Record<string, string | undefined> | undefined
  runFails?: ((attempt: CommandAttempt) => { stderr: string } | undefined) | undefined
  runAnswers?: ((attempt: CommandAttempt) => string | undefined) | undefined
  serviceTtlSeconds?: number | undefined
  runDelay?: ((attempt: CommandAttempt) => number | undefined) | undefined
}) => {
  const env: Record<string, string | undefined> = args.env ?? {}
  const contents = new Map(Object.entries(args.contents ?? {}))
  for (const path of args.present ?? []) {
    if (!contents.has(path)) contents.set(path, '')
  }
  const commands: CommandAttempt[] = []
  const events: string[] = []

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
    events.push(attempt.command.join(' '))
    const delay = args.runDelay?.(attempt)
    if (delay !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    const failure = args.runFails?.(attempt)
    if (failure !== undefined) return { ok: false, stdout: '', stderr: failure.stderr }
    const answer = args.runAnswers?.(attempt)
    if (answer !== undefined) return { ok: true, stdout: answer, stderr: '' }
    return { ok: true, stdout: '', stderr: '' }
  }

  const apply = createEnvironmentProfile({
    env,
    files,
    run,
    home: HOME,
    serviceTtlSeconds: args.serviceTtlSeconds,
  })
  return { env, contents, commands, events, apply }
}

export const outcomeOf = (profile: EnvironmentProfile, step: EProfileStep): ProfileStepOutcome => {
  const outcome = profile.steps.find((one) => one.step === step)
  if (outcome === undefined) throw new Error(`no outcome recorded for ${step}`)
  return outcome
}

export const seededScan = (attempt: CommandAttempt): string | undefined =>
  attempt.command[0] === 'ssh-keyscan' ? KEYSCAN_OUTPUT : undefined
