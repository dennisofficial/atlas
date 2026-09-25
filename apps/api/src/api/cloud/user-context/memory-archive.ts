import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { BadRequestException } from '@nestjs/common'

export type ExtractedMemoryEntry = {
  key: string
  content: Buffer
  mtimeMs: number
}

export type StoredMemoryEntry = {
  key: string
  content: Buffer
  mtimeMs: bigint
}

const TAR_NOT_FOUND_MESSAGE =
  'the system tar command was not found on PATH — install tar to use Atlas Cloud memory archives'

const runTar = (args: { argv: readonly string[] }): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile('tar', args.argv, (error, _stdout, stderr) => {
      if (error === null) {
        resolve()
        return
      }
      if (error.code === 127 || error.errno === -2) {
        reject(new Error(TAR_NOT_FOUND_MESSAGE))
        return
      }
      reject(new Error(`tar ${args.argv[0] ?? ''} failed: ${stderr.trim() || error.message}`))
    })
  })

/**
 * The archive is read with the platform's own `tar` — macOS bsdtar and the deploy image's GNU
 * tar both read each other's ustar/pax output — so no archive library ever joins the dependency
 * tree for it.
 */
export async function extractMemoryArchive(args: {
  archive: Buffer
}): Promise<readonly ExtractedMemoryEntry[]> {
  const workDir = await mkdtemp(join(tmpdir(), 'atlas-memory-extract-'))
  const contentDir = join(workDir, 'content')
  const archivePath = join(workDir, 'archive.tar.gz')

  try {
    await mkdir(contentDir, { recursive: true })
    await writeFile(archivePath, args.archive)
    await runTar({
      argv: ['-xzf', archivePath, '-C', contentDir, '--no-same-owner', '--no-same-permissions'],
    })

    const listed = await readdir(contentDir, { recursive: true, withFileTypes: true })
    const entries: ExtractedMemoryEntry[] = []
    for (const entry of listed) {
      if (!entry.isFile()) continue
      const path = join(entry.parentPath, entry.name)
      const key = relative(contentDir, path).split(sep).join('/')
      const stats = await stat(path)
      entries.push({ key, content: await readFile(path), mtimeMs: stats.mtimeMs })
    }
    return entries
  } catch (error) {
    if (error instanceof BadRequestException) throw error
    if (error instanceof Error && error.message === TAR_NOT_FOUND_MESSAGE) throw error
    throw new BadRequestException('could not read the memory archive as tar.gz')
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Stages each stored row under its wire key and tars the staging dir. `utimes` restores the
 * stored mtime so the archive carries it back to clients — tar's header granularity is one
 * second, so mtimes round down by up to 999ms across the round trip and callers compare with
 * that tolerance in mind.
 */
export async function buildMemoryArchive(args: {
  entries: readonly StoredMemoryEntry[]
}): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), 'atlas-memory-build-'))
  const contentDir = join(workDir, 'content')
  const archivePath = join(workDir, 'archive.tar.gz')

  try {
    await mkdir(contentDir, { recursive: true })
    for (const entry of args.entries) {
      const target = join(contentDir, entry.key)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, entry.content)
      const mtime = new Date(Number(entry.mtimeMs))
      await utimes(target, mtime, mtime)
    }
    await runTar({ argv: ['-czf', archivePath, '-C', contentDir, '.'] })
    return await readFile(archivePath)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
