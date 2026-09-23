import type { ApplyEnvironmentProfile } from '../environment-profile'
import { createEnsureWorkspace, type GitRunner } from '../materialize-workspace'
import type { WorkspaceFiles } from '../workspace-files'
import type { WorkspaceSpec } from '../workspace-spec'

export const CWD = '/workspace'

export const TOKEN = 'gho_secret-token'

export const spec = (partial: Partial<WorkspaceSpec> = {}): WorkspaceSpec => ({
  remoteUrl: 'git@github.com:dennisofficial/atlas.git',
  branch: 'dennis/container-cloud',
  commit: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
  patch: '',
  githubToken: TOKEN,
  contextBundle: null,
  ...partial,
})

export type Attempt = { args: readonly string[]; cwd: string }

export const harness = (args: {
  present?: readonly string[] | undefined
  fails?: ((attempt: Attempt) => { stderr: string } | undefined) | undefined
  answers?: ((attempt: Attempt) => string | undefined) | undefined
  profile?: ApplyEnvironmentProfile | undefined
}) => {
  const attempts: Attempt[] = []
  const written: { path: string; text: string }[] = []
  const emptied: string[] = []
  const present = new Set(args.present ?? [])

  const git: GitRunner = async (attempt) => {
    attempts.push(attempt)
    const failure = args.fails?.(attempt)
    if (failure !== undefined) return { ok: false, stdout: '', stderr: failure.stderr }
    return { ok: true, stdout: args.answers?.(attempt) ?? '', stderr: '' }
  }

  const files: WorkspaceFiles = {
    exists: async (path) => present.has(path),
    read: async () => {
      throw new Error('not exercised in these specs')
    },
    write: async (given) => {
      written.push(given)
      present.add(given.path)
    },
    writeBytes: async ({ path, bytes }) => {
      written.push({ path, text: bytes.toString('utf8') })
      present.add(path)
    },
    empty: async (path) => {
      emptied.push(path)
    },
  }

  return { attempts, written, emptied, ensure: createEnsureWorkspace({ git, files, profile: args.profile }) }
}

export const argsOf = (attempts: readonly Attempt[]): string[][] =>
  attempts.map((attempt) => [...attempt.args])

export const TIP = 'ba51e1e0000000000000000000000000000000ff'

export const TREE = '7ee1ab1e000000000000000000000000000000aa'

export const PATCHED_TREE = '1f2e3d4c000000000000000000000000000000bb'

export const revParseAnswers = (attempt: Attempt): string | undefined => {
  if (attempt.args[0] === 'write-tree') return `${PATCHED_TREE}\n`
  if (attempt.args[0] !== 'rev-parse') return undefined
  return attempt.args.at(-1) === 'HEAD^{tree}' ? `${TREE}\n` : `${TIP}\n`
}
