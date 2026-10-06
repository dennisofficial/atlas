import { randomBytes } from 'node:crypto'
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { safeRelativeSegment } from '../files/safe-relative-path'
import { locationOfPlacement, type PlacementRecord, type ThreadId, type WorkspaceIdentity } from '@dltech/atlas-core'
import { readMeta, sessionMetaSchema, threadMetaSchema, writeMeta } from '../store/sessions/meta'
import { metaWithPlacement } from '../store/sessions/placement-meta'
import { sessionMetaFile, threadMetaFile } from '../store/sessions/paths'
import { openArchiveFile, type SessionArchiveFile } from './archive-file'
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

const stageFile = async (args: { sessionDir: string; contentDir: string; key: string }): Promise<void> => {
  const source = join(args.sessionDir, args.key)
  const target = join(args.contentDir, args.key)
  try {
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { preserveTimestamps: true })
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
}): Promise<void> => {
  const contentDir = join(args.stagingDir, 'content')
  const listFile = join(args.stagingDir, 'files.list')
  await mkdir(contentDir, { recursive: true })
  for (const key of args.keys) await stageFile({ sessionDir: args.sessionDir, contentDir, key })
  await writeFile(listFile, args.keys.map((key) => `./${key}\0`).join(''))
  await runTar({
    argv: ['-czf', args.output, '-C', contentDir, '--null', '-T', listFile],
    ...(args.tarCommand === undefined ? {} : { tarCommand: args.tarCommand }),
  })
}

export async function buildSessionArchive(args: {
  sessionDir: string
  archivePath?: string | undefined
  tarCommand?: string | undefined
}): Promise<SessionArchiveFile | undefined> {
  const found = await walkRegularFiles({ root: args.sessionDir })
  const keys = (found ?? []).filter((key) => isPortableSessionFile({ key }))
  if (keys.length === 0) return undefined
  await assertShellsTerminal({ sessionDir: args.sessionDir, keys })

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
