import { randomBytes } from 'node:crypto'
import { cp, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { safeRelativeSegment } from '../files/safe-relative-path'
import { locationOfPlacement, type PlacementRecord, type ThreadId, type WorkspaceIdentity } from '@dltech/atlas-core'
import { readMeta, sessionMetaSchema, threadMetaSchema, writeMeta } from '../store/sessions/meta'
import { metaWithPlacement } from '../store/sessions/placement-meta'
import { sessionMetaFile, threadMetaFile } from '../store/sessions/paths'
import { openArchiveFile, type SessionArchiveFile } from './archive-file'
import type { ArchiveBuildReporter } from './archive-build-progress'
import { assertShellsTerminal, isPortableSessionFile, markShellsImported } from './portable-session-file'
import { SessionWalkError, walkRegularFiles } from './session-walker'

export type { SessionArchiveFile } from './archive-file'

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

const stageFile = async (args: { sessionDir: string; contentDir: string; key: string }): Promise<number> => {
  const source = join(args.sessionDir, args.key)
  const target = join(args.contentDir, args.key)
  try {
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { preserveTimestamps: true })
    return (await stat(source)).size
  } catch (cause) {
    throw new SessionWalkError({ path: source, cause })
  }
}

const buildTarball = async (args: {
  sessionDir: string
  keys: readonly string[]
  stagingDir: string
  output: string
  tarCommand?: string | undefined
  report?: ArchiveBuildReporter | undefined
}): Promise<void> => {
  const contentDir = join(args.stagingDir, 'content')
  const listFile = join(args.stagingDir, 'files.list')
  await mkdir(contentDir, { recursive: true })
  let bytes = 0
  let staged = 0
  for (const key of args.keys) {
    bytes += await stageFile({ sessionDir: args.sessionDir, contentDir, key })
    staged += 1
    args.report?.({ phase: 'staging', files: staged, bytes })
  }
  await writeFile(listFile, args.keys.map((key) => `./${key}\0`).join(''))
  args.report?.({ phase: 'compressing', files: staged, bytes, totalBytes: bytes })
  // Pipe tar to `gzip -1` rather than `tar -czf`: this is a one-shot transfer artifact extracted
  // with `tar -xzf`, which is compression-level agnostic, so the fastest level wins capture CPU.
  const tarCommand = args.tarCommand ?? 'tar'
  const tar = Bun.spawn([tarCommand, '-cf', '-', '-C', contentDir, '--null', '-T', listFile], {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  })
  const gzip = Bun.spawn(['gzip', '-1'], { stdin: tar.stdout, stdout: Bun.file(args.output), stderr: 'pipe' })
  const [tarStderr, tarStatus, gzipStderr, gzipStatus] = await Promise.all([
    new Response(tar.stderr).text(),
    tar.exited,
    new Response(gzip.stderr).text(),
    gzip.exited,
  ])
  // gzip turns an empty stdin into a valid empty archive and exits 0, so a tar that died before
  // writing anything would otherwise read as success. Reject both a nonzero exit and empty output.
  const produced = (await stat(args.output)).size > 0
  if (tarStatus !== 0 || !produced) throw new Error(`tar -c failed: ${tarStderr.trim() || `exit code ${tarStatus}`}`)
  if (gzipStatus !== 0) throw new Error(`gzip failed: ${gzipStderr.trim() || `exit code ${gzipStatus}`}`)
}

export async function buildSessionArchive(args: {
  sessionDir: string
  archivePath?: string | undefined
  tarCommand?: string | undefined
  onBuildProgress?: ArchiveBuildReporter | undefined
}): Promise<SessionArchiveFile | undefined> {
  const found = await walkRegularFiles({ root: args.sessionDir })
  const keys = (found ?? []).filter((key) => isPortableSessionFile({ key }))
  if (keys.length === 0) return undefined
  await assertShellsTerminal({ sessionDir: args.sessionDir, keys })
  args.onBuildProgress?.({ phase: 'walking', files: keys.length, bytes: 0 })

  const stagingDir = await mkdtemp(join(tmpdir(), 'atlas-session-build-'))
  const destination = args.archivePath
  const output =
    destination === undefined
      ? join(stagingDir, 'archive.tar.gz')
      : `${destination}.${randomBytes(6).toString('hex')}.partial`
  let published = false
  let handedOff = false
  try {
    if (destination !== undefined) await mkdir(dirname(destination), { recursive: true })
    await buildTarball({
      sessionDir: args.sessionDir,
      keys,
      stagingDir,
      output,
      ...(args.tarCommand === undefined ? {} : { tarCommand: args.tarCommand }),
      ...(args.onBuildProgress === undefined ? {} : { report: args.onBuildProgress }),
    })
    if (destination === undefined) {
      const file = await openArchiveFile({ path: output, disposeTarget: stagingDir })
      handedOff = true
      return file
    }
    await rename(output, destination)
    published = true
    return await openArchiveFile({ path: destination, disposeTarget: destination })
  } catch (error) {
    if (published && destination !== undefined) await rm(destination, { force: true }).catch(() => undefined)
    throw error
  } finally {
    if (!handedOff) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
      await rm(output, { force: true }).catch(() => undefined)
    }
  }
}

export async function extractSessionArchive(args: {
  archivePath: string
  sessionDir: string
  tarCommand?: string | undefined
  preserveOwnership?: { threadId: ThreadId; record: PlacementRecord; workspace: WorkspaceIdentity } | undefined
}): Promise<void> {
  await mkdir(dirname(args.sessionDir), { recursive: true })
  const workDir = await mkdtemp(join(dirname(args.sessionDir), '.atlas-session-extract-'))
  let preserveRecovery = false
  const contentDir = join(workDir, 'content')
  await mkdir(contentDir, { recursive: true })

  try {
    await runTar({
      argv: ['-xzf', args.archivePath, '-C', contentDir, '--no-same-owner', '--no-same-permissions'],
      ...(args.tarCommand === undefined ? {} : { tarCommand: args.tarCommand }),
    })

    const keys = (await walkRegularFiles({ root: contentDir })) ?? []
    const staged = keys.filter((key) => safeRelativeSegment(key) !== null && isPortableSessionFile({ key }))

    const replacement = join(workDir, 'replacement')
    await mkdir(replacement)
    for (const key of staged) {
      const target = join(replacement, key)
      await mkdir(dirname(target), { recursive: true })
      await rename(join(contentDir, key), target)
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
