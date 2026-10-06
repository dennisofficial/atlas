import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'
import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'

import { buildSessionArchive, extractSessionArchive } from '../../session-archive'
import { CLOUD_THREAD } from './cloud-fixture-ids'

const REMOTE_EXPORT_DIRECTORY = '/atlas/home/exports'

const localFiles = new Map<string, string>()
let scratch: Promise<string> | undefined

afterEach(async () => {
  localFiles.clear()
  const pending = scratch
  scratch = undefined
  if (pending !== undefined) await rm(await pending, { recursive: true, force: true })
})

const scratchPath = async (name: string): Promise<string> => {
  scratch ??= mkdtemp(join(tmpdir(), 'atlas-fake-exports-'))
  return join(await scratch, name)
}

const generation = (): string => randomBytes(6).toString('hex')

const sha256Of = async (file: string): Promise<string> => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export const exportedArchiveOf = async (args: {
  file: string
  threadId?: ThreadId | undefined
}): Promise<SessionArchiveDescriptor> => {
  const threadId = args.threadId ?? CLOUD_THREAD
  const path = `${REMOTE_EXPORT_DIRECTORY}/session-${threadId}-${generation()}.tar.gz`
  localFiles.set(path, args.file)
  return { path, size: (await stat(args.file)).size, sha256: await sha256Of(args.file), threadId }
}

export const exportedBytesOf = async (args: {
  bytes: Uint8Array
  threadId?: ThreadId | undefined
}): Promise<SessionArchiveDescriptor> => {
  const file = await scratchPath(`bytes-${generation()}.tar.gz`)
  await writeFile(file, args.bytes)
  return exportedArchiveOf({ file, threadId: args.threadId })
}

export const exportedSessionDirOf = async (args: {
  sessionDir: string
  threadId?: ThreadId | undefined
}): Promise<SessionArchiveDescriptor | null> => {
  const built = await buildSessionArchive({
    sessionDir: args.sessionDir,
    archivePath: await scratchPath(`built-${generation()}.tar.gz`),
  })
  if (built === undefined) return null
  return exportedArchiveOf({ file: built.path, threadId: args.threadId })
}

export const localFileOfExport = (archive: SessionArchiveDescriptor): string => {
  const file = localFiles.get(archive.path)
  if (file === undefined) throw new Error(`the fixture exported nothing at ${archive.path}`)
  return file
}

export const copyExportTo = (args: {
  archive: SessionArchiveDescriptor
  destination: string
}): Promise<void> => copyFile(localFileOfExport(args.archive), args.destination)

export const copyTranscriptUpload = async (args: { source: string }): Promise<string> => {
  const copy = await scratchPath(`uploaded-${generation()}.tar.gz`)
  await copyFile(args.source, copy)
  return copy
}

export const archiveDescriptorOf = async ({
  sessionDir,
}: {
  sessionDir: string
}): Promise<SessionArchiveDescriptor> => {
  const exported = await exportedSessionDirOf({ sessionDir })
  if (exported === null) throw new Error('the staged session directory holds nothing to archive')
  return exported
}

export const extractExportInto = ({
  archive,
  sessionDir,
}: {
  archive: SessionArchiveDescriptor
  sessionDir: string
}): Promise<void> => extractSessionArchive({ archivePath: localFileOfExport(archive), sessionDir })
