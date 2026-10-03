import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'

import { safeRelativeSegment } from '../files/safe-relative-path'
import { locationOfPlacement, type PlacementRecord, type ThreadId, type WorkspaceIdentity } from '@dltech/atlas-core'
import { readMeta, sessionMetaSchema, threadMetaSchema, writeMeta } from '../store/sessions/meta'
import { metaWithPlacement } from '../store/sessions/placement-meta'
import { sessionMetaFile, threadMetaFile } from '../store/sessions/paths'
import { assertShellsTerminal, isPortableSessionFile, markShellsImported } from './portable-session-file'

/**
 * The session transcript moves between machines as a `.tar.gz` of the session directory, built and
 * read with the platform's own `tar` for the same reason the context archive is: no archive
 * library joins the dependency tree, and macOS bsdtar and the sandbox image's GNU tar read each
 * other's output. The session lock and each shell's control token, socket, lock and leases are left
 * out — they name processes of one machine, which never survive the move. A shell without a terminal
 * status.json refuses the build: its process could still be writing.
 */
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
  const keys = (await collectFiles(args.sessionDir)).filter((key) => isPortableSessionFile({ key }))
  if (keys.length === 0) return undefined
  await assertShellsTerminal({ sessionDir: args.sessionDir, keys })

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
  preserveOwnership?: { threadId: ThreadId; record: PlacementRecord; workspace: WorkspaceIdentity } | undefined
}): Promise<void> {
  await mkdir(dirname(args.sessionDir), { recursive: true })
  const workDir = await mkdtemp(join(dirname(args.sessionDir), '.atlas-session-extract-'))
  let preserveRecovery = false
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
    const staged = keys.filter((key) => safeRelativeSegment(key) !== null && isPortableSessionFile({ key }))

    const replacement = join(workDir, 'replacement')
    await mkdir(replacement)
    for (const key of staged) {
      const target = join(replacement, key)
      await mkdir(join(target, '..'), { recursive: true })
      await cp(join(contentDir, key), target, { recursive: true })
    }
    await markShellsImported({ root: replacement, keys: staged })
    const held = args.preserveOwnership
    if (held !== undefined) {
      const file = threadMetaFile({ sessionDir: replacement, threadId: held.threadId })
      const meta = await readMeta({ file, schema: threadMetaSchema })
      if (meta === undefined) throw new Error('the incoming transcript holds no root ownership record')
      await writeMeta({ file, meta: metaWithPlacement({ meta: { ...meta, workspace: held.workspace.workspace, repo: held.workspace.repo }, record: held.record }) })
      const rootFile = sessionMetaFile({ sessionDir: replacement })
      const root = await readMeta({ file: rootFile, schema: sessionMetaSchema })
      if (root !== undefined) await writeMeta({ file: rootFile, meta: { ...root, home: locationOfPlacement(held.record.placement), workspace: held.workspace.workspace, repo: held.workspace.repo } })
    }
    const previous = join(workDir, 'previous')
    let movedPrevious = false
    try {
      await rename(args.sessionDir, previous)
      movedPrevious = true
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    }
    try {
      await rename(replacement, args.sessionDir)
    } catch (error) {
      if (movedPrevious) {
        try {
          await rename(previous, args.sessionDir)
        } catch (rollbackError) {
          preserveRecovery = true
          throw new AggregateError([error, rollbackError], `the previous transcript is preserved at ${previous}`)
        }
      }
      throw error
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(messageOf(error))
  } finally {
    if (!preserveRecovery) await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
