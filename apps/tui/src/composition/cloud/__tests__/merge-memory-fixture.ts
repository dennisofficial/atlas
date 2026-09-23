import { access, mkdtemp, realpath, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const freshDirectory = async (prefix: string): Promise<string> =>
  mkdtemp(join(tmpdir(), prefix))

export const SESSION = { url: 'https://cloud.test', token: 'sess_test' }

export const fetchReturning = (
  bundle: Record<string, { content: string; mtime: number }> | null,
): typeof fetch =>
  (async (_input: unknown, _init?: RequestInit) =>
    new Response(JSON.stringify({ bundle: bundle === null ? null : JSON.stringify(bundle) }), {
      status: 200,
    })) as typeof fetch

export const setMtime = async (path: string, ms: number): Promise<void> => {
  const at = new Date(ms)
  await utimes(path, at, at)
}

export const entryFor = (text: string, mtime: number): { content: string; mtime: number } => ({
  content: Buffer.from(text).toString('base64'),
  mtime,
})

export const projectKey = (args: { projectDirectory: string; name: string }): string =>
  `project/${encodeURIComponent(args.projectDirectory)}/${args.name}`

export const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export const git = (args: { args: string[]; cwd: string }): void => {
  const run = Bun.spawnSync(['git', ...args.args], { cwd: args.cwd })
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.args.join(' ')} failed: ${run.stderr.toString()}`)
  }
}

export const initRepoWithOrigin = async (origin: string): Promise<string> => {
  const repo = await realpath(await freshDirectory('atlas-merge-repo-'))
  git({ args: ['init', '--initial-branch=main'], cwd: repo })
  git({ args: ['remote', 'add', 'origin', origin], cwd: repo })
  return repo
}

export const acceptOf = (init: RequestInit | undefined): string | undefined => {
  const headers = init?.headers as Record<string, string> | undefined
  return headers?.accept
}

/**
 * Answers a real gzip archive to the `Accept: application/gzip` request and 404s every other
 * request — the shape a control plane with only an archive stored actually sends.
 */
export const fetchServingArchive = (archive: Buffer): typeof fetch =>
  (async (_input: unknown, init?: RequestInit) => {
    if (acceptOf(init) === 'application/gzip') {
      return new Response(new Uint8Array(archive), { status: 200 })
    }
    return new Response('', { status: 404 })
  }) as typeof fetch

/** 404s the archive request and answers the legacy JSON bundle to everything else. */
export const fetchServingLegacyOnly = (
  bundle: Record<string, { content: string; mtime: number }> | null,
): typeof fetch =>
  (async (_input: unknown, init?: RequestInit) => {
    if (acceptOf(init) === 'application/gzip') return new Response('', { status: 404 })
    return new Response(JSON.stringify({ bundle: bundle === null ? null : JSON.stringify(bundle) }), {
      status: 200,
    })
  }) as typeof fetch
