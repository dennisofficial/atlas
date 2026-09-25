import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

import { safeRelativeSegment } from '../files/safe-relative-path'

/**
 * The session transcript moves between machines as a `.tar.gz` of the session directory, built and
 * read with the platform's own `tar` for the same reason the context archive is: no archive
 * library joins the dependency tree, and macOS bsdtar and the sandbox image's GNU tar read each
 * other's output. The session lock is left out — it names the process that holds it, which never
 * survives the move.
 */
const SESSION_LOCK_NAME = 'lock'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const runTar = async (args: {
  argv: readonly string[]
  tarCommand?: string | undefined
}): Promise<void> => {
  const command = args.tarCommand ?? 'tar'
  const proc = Bun.spawn([command, ...args.argv], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const [stderr, status] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  if (status !== 0) {
    throw new Error(`tar ${args.argv[0] ?? ''} failed: ${stderr.trim() || `exit code ${status}`}`)
  }
}

const collectFiles = async (directory: string): Promise<readonly string[]> => {
  let listed
  try {
    listed = await readdir(directory, { recursive: true, withFileTypes: true })
  } catch {
    return []
  }
  return listed
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
}

export async function buildSessionArchive(args: {
  sessionDir: string
  tarCommand?: string | undefined
}): Promise<Buffer | undefined> {
  const keys = (await collectFiles(args.sessionDir)).filter((key) => key !== SESSION_LOCK_NAME)
  if (keys.length === 0) return undefined

  const workDir = await mkdtemp(join(tmpdir(), 'atlas-session-build-'))
  const contentDir = join(workDir, 'content')
  const archivePath = join(workDir, 'archive.tar.gz')
  await mkdir(contentDir, { recursive: true })

  try {
    for (const key of keys) {
      const target = join(contentDir, key)
      await mkdir(join(target, '..'), { recursive: true })
      await cp(join(args.sessionDir, key), target, { preserveTimestamps: true })
    }
    await runTar({
      argv: ['-czf', archivePath, '-C', contentDir, '.'],
      ...(args.tarCommand === undefined ? {} : { tarCommand: args.tarCommand }),
    })
    return await readFile(archivePath)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Replaces the target session directory wholesale: the machine the archive came from was the
 * transcript's home while it was away, so anything the local copy held from before is stale. An
 * entry that would escape the session directory is skipped rather than trusted.
 */
export async function extractSessionArchive(args: {
  archive: Uint8Array
  sessionDir: string
  tarCommand?: string | undefined
}): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'atlas-session-extract-'))
  const contentDir = join(workDir, 'content')
  const archivePath = join(workDir, 'archive.tar.gz')
  await mkdir(contentDir, { recursive: true })

  try {
    await writeFile(archivePath, args.archive)
    await runTar({
      argv: ['-xzf', archivePath, '-C', contentDir, '--no-same-owner', '--no-same-permissions'],
      ...(args.tarCommand === undefined ? {} : { tarCommand: args.tarCommand }),
    })

    const keys = await collectFiles(contentDir)
    const staged = keys.filter((key) => safeRelativeSegment(key) !== null)

    await rm(args.sessionDir, { recursive: true, force: true })
    await mkdir(args.sessionDir, { recursive: true })
    for (const key of staged) {
      const target = join(args.sessionDir, key)
      await mkdir(join(target, '..'), { recursive: true })
      await cp(join(contentDir, key), target, { recursive: true })
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(messageOf(error))
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
