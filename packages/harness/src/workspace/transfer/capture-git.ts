import type { GitRun } from '../run-git'

const READ_ONLY_CONFIG = [
  '-c', 'core.fsmonitor=false',
  '-c', 'gc.auto=0',
  '-c', 'maintenance.auto=0',
  '-c', 'trace2.eventTarget=',
  '-c', 'trace2.normalTarget=',
  '-c', 'trace2.perfTarget=',
] as const

const REDIRECTING_VARIABLES = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_QUARANTINE_PATH',
  'GIT_OPTIONAL_LOCKS',
])

const TRACE_PREFIX = 'GIT_TRACE'

const SILENCED_TRACES = { GIT_TRACE2: '0', GIT_TRACE2_EVENT: '0', GIT_TRACE2_PERF: '0' }

const isInherited = (key: string): boolean =>
  !REDIRECTING_VARIABLES.has(key) && !key.startsWith(TRACE_PREFIX)

const sanitizedEnvironment = (extra: Record<string, string>): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && isInherited(key)) env[key] = value
  }
  return { ...env, ...extra, ...SILENCED_TRACES, GIT_OPTIONAL_LOCKS: '0' }
}

export async function captureGit({
  args,
  cwd,
  env,
  stdinPath,
}: {
  args: readonly string[]
  cwd: string
  env?: Record<string, string>
  stdinPath?: string
}): Promise<GitRun> {
  try {
    const git = Bun.spawn(['git', ...READ_ONLY_CONFIG, ...args], {
      cwd,
      env: sanitizedEnvironment(env ?? {}),
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: stdinPath === undefined ? 'ignore' : Bun.file(stdinPath),
    })
    const [stdout, stderr, status] = await Promise.all([
      new Response(git.stdout).text(),
      new Response(git.stderr).text(),
      git.exited,
    ])
    return { ok: status === 0, stdout, stderr }
  } catch (error) {
    return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}
