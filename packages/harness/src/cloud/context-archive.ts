import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

export type ArchiveFileSource = { key: string; path: string }

export type ExtractedArchiveEntry = { key: string; path: string; mtimeMs: number }

export type ExtractedContextArchive = {
  entries: readonly ExtractedArchiveEntry[]
  cleanup: () => Promise<void>
}

const TAR_NOT_FOUND_MESSAGE =
  'the system tar command was not found on PATH — install tar to use Atlas Cloud context archives'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * The context archive is built and read with the platform's own `tar` — macOS bsdtar and the
 * sandbox image's GNU tar both read each other's ustar/pax output — so no archive library ever
 * joins the dependency tree for it.
 */
const runTar = async (args: { argv: readonly string[]; tarCommand?: string | undefined }): Promise<void> => {
  const command = args.tarCommand ?? 'tar'
  let proc
  try {
    proc = Bun.spawn([command, ...args.argv], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(TAR_NOT_FOUND_MESSAGE)
    }
    throw error
  }

  const [stderr, status] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  if (status !== 0) {
    throw new Error(`tar ${args.argv[0] ?? ''} failed: ${stderr.trim() || `exit code ${status}`}`)
  }
}

const freshWorkDir = (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

/**
 * Builds a `.tar.gz` from a staged copy of each source file under its wire key, so callers never
 * hand tar a working tree directly. `cp`'s `preserveTimestamps` is what lets the archive carry the
 * source's real mtime — the memory merge's last-writer-wins comparison depends on it surviving the
 * round trip. A source that vanishes between listing and staging is skipped rather than failing the
 * whole archive, matching how the callers already tolerate a file disappearing mid-capture.
 */
export async function buildContextArchive(args: {
  files: readonly ArchiveFileSource[]
  tarCommand?: string | undefined
}): Promise<Buffer | undefined> {
  if (args.files.length === 0) return undefined

  const workDir = await freshWorkDir('atlas-ctx-build-')
  const contentDir = join(workDir, 'content')
  const archivePath = join(workDir, 'archive.tar.gz')
  await mkdir(contentDir, { recursive: true })

  try {
    let staged = 0
    for (const file of args.files) {
      const target = join(contentDir, file.key)
      try {
        await mkdir(join(target, '..'), { recursive: true })
        await cp(file.path, target, { preserveTimestamps: true, dereference: true })
        staged += 1
      } catch {
        continue
      }
    }
    if (staged === 0) return undefined

    await runTar({
      argv: ['-czf', archivePath, '-C', contentDir, '.'],
      ...(args.tarCommand === undefined ? {} : { tarCommand: args.tarCommand }),
    })
    return await readFile(archivePath)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

const collectEntries = async (contentDir: string): Promise<readonly ExtractedArchiveEntry[]> => {
  let listed
  try {
    listed = await readdir(contentDir, { recursive: true, withFileTypes: true })
  } catch {
    return []
  }

  const entries: ExtractedArchiveEntry[] = []
  for (const entry of listed) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    const key = relative(contentDir, path).split(sep).join('/')
    try {
      const stats = await stat(path)
      entries.push({ key, path, mtimeMs: stats.mtimeMs })
    } catch {
      continue
    }
  }
  return entries
}

/**
 * Unpacks a `.tar.gz` into a fresh staging directory and reports every file it holds, key and
 * on-disk path and the mtime tar restored — the same mtime the archive was built with, within
 * tar's one-second header granularity. The caller owns mapping each key onto a real target and
 * must call `cleanup` once it is done reading, since the staging directory otherwise leaks.
 */
export async function extractContextArchive(args: {
  archive: Uint8Array
  tarCommand?: string | undefined
}): Promise<ExtractedContextArchive> {
  const workDir = await freshWorkDir('atlas-ctx-extract-')
  const contentDir = join(workDir, 'content')
  const archivePath = join(workDir, 'archive.tar.gz')
  await mkdir(contentDir, { recursive: true })

  const cleanup = (): Promise<void> => rm(workDir, { recursive: true, force: true }).then(
    () => undefined,
    () => undefined,
  )

  try {
    await writeFile(archivePath, args.archive)
    await runTar({
      argv: ['-xzf', archivePath, '-C', contentDir, '--no-same-owner', '--no-same-permissions'],
      ...(args.tarCommand === undefined ? {} : { tarCommand: args.tarCommand }),
    })
    await rm(archivePath, { force: true }).catch(() => undefined)
    return { entries: await collectEntries(contentDir), cleanup }
  } catch (error) {
    await cleanup()
    if (error instanceof Error) throw error
    throw new Error(messageOf(error))
  }
}

export { TAR_NOT_FOUND_MESSAGE }
