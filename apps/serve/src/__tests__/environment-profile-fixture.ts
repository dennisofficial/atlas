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

export const TREE_ID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
export const COMMIT_ID = '9fceb02d0ae598e95dc970b74767f19372d61af8'
const CONFIG_LOCK_STDERR = 'error: could not lock config file .git/config: File exists'

export type CommandAttempt = { command: readonly string[]; cwd: string; stdin?: string | undefined }
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
  gitConfigDelayMs?: number | undefined
  runDelay?: ((attempt: CommandAttempt) => number | undefined) | undefined
}) => {
  const env: Record<string, string | undefined> = args.env ?? {}
  const contents = new Map(Object.entries(args.contents ?? {}))
  for (const path of args.present ?? []) {
    if (!contents.has(path)) contents.set(path, '')
  }
  const commands: CommandAttempt[] = []
  const gitAttempts: GitAttempt[] = []
  const events: string[] = []
  const gitConfig = new Map<string, string>()
  const stats = { maxConfigWriters: 0 }
  let configWriters = 0

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
    const isMktree = attempt.command.join(' ') === 'git mktree'
    return { ok: true, stdout: isMktree ? `${TREE_ID}\n` : '', stderr: '' }
  }

  const writeConfig = async (key: string, value: string) => {
    configWriters += 1
    stats.maxConfigWriters = Math.max(stats.maxConfigWriters, configWriters)
    try {
      if (configWriters > 1) return { ok: false, stdout: '', stderr: CONFIG_LOCK_STDERR }
      await new Promise((resolve) => setTimeout(resolve, args.gitConfigDelayMs ?? 1))
      gitConfig.set(key, value)
      return { ok: true, stdout: '', stderr: '' }
    } finally {
      configWriters -= 1
    }
  }

  const git: GitRunner = async (attempt) => {
    gitAttempts.push(attempt)
    events.push(`git ${attempt.args.join(' ')}`)
    const failure = args.gitFails?.(attempt)
    if (failure !== undefined) return { ok: false, stdout: '', stderr: failure.stderr }
    const [verb, key, value] = attempt.args
    if (verb === 'config' && key !== undefined && value !== undefined) {
      return await writeConfig(key, value)
    }
    const answer = args.gitAnswers?.(attempt)
    if (answer !== undefined) return { ok: true, stdout: answer, stderr: '' }
    if (verb === 'config' && key !== undefined) {
      const stored = gitConfig.get(key)
      if (stored === undefined) return { ok: false, stdout: '', stderr: '' }
      return { ok: true, stdout: `${stored}\n`, stderr: '' }
    }
    if (verb === 'commit-tree') return { ok: true, stdout: `${COMMIT_ID}\n`, stderr: '' }
    return { ok: true, stdout: '', stderr: '' }
  }

  const apply = createEnvironmentProfile({
    env,
    files,
    run,
    git,
    home: HOME,
    serviceTtlSeconds: args.serviceTtlSeconds,
  })
  return { env, contents, commands, gitAttempts, events, gitConfig, stats, apply }
}

export const outcomeOf = (profile: EnvironmentProfile, step: EProfileStep): ProfileStepOutcome => {
  const outcome = profile.steps.find((one) => one.step === step)
  if (outcome === undefined) throw new Error(`no outcome recorded for ${step}`)
  return outcome
}

export const seededScan = (attempt: CommandAttempt): string | undefined =>
  attempt.command[0] === 'ssh-keyscan' ? KEYSCAN_OUTPUT : undefined
