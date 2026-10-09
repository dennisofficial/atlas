import { posix } from 'node:path'

import { downloadArchiveFile } from './archive-download'
import {
  DRIVE_HOME_PATH,
  SESSION_EXPORT_DIRECTORY_NAME,
  SESSION_EXPORT_FILE_PATTERN,
  type SessionArchiveDescriptor,
} from '@dltech/atlas-wire'
import type { TransferProgress } from './transfer-progress'
import type { ArchiveDownloadSandbox, ArchiveUploadSandbox } from './workspace-archive-transport'

export const SESSION_EXPORT_DIRECTORY = `${DRIVE_HOME_PATH}/${SESSION_EXPORT_DIRECTORY_NAME}`

export const exportedSessionPathOf = (args: { path: string; threadId: string }): string => {
  const normalized = posix.normalize(args.path)
  const basename = posix.basename(normalized)
  const prefix = `session-${args.threadId}-`
  if (
    !/^[A-Za-z0-9_-]+$/.test(args.threadId) ||
    normalized !== args.path ||
    posix.dirname(normalized) !== SESSION_EXPORT_DIRECTORY ||
    !SESSION_EXPORT_FILE_PATTERN.test(basename) ||
    !basename.startsWith(prefix) ||
    !/^[a-f0-9]{12}\.tar\.gz$/.test(basename.slice(prefix.length))
  ) {
    throw new Error(`refusing to transfer ${args.path}: it is not an export of session ${args.threadId}`)
  }
  return normalized
}

export type SessionDownloadArgs = {
  sandbox: ArchiveDownloadSandbox
  threadId: string
  archive: SessionArchiveDescriptor
  destination: string
  onProgress?: ((progress: TransferProgress) => void) | undefined
}

export async function downloadSessionArchive(args: SessionDownloadArgs): Promise<void> {
  if (args.archive.threadId !== args.threadId) throw new Error('the session archive export names a different root')
  const path = exportedSessionPathOf({ path: args.archive.path, threadId: args.threadId })
  const stream = await args.sandbox.readFile({ path })
  if (stream === null) throw new Error(`the sandbox holds no session export at ${path}`)
  await downloadArchiveFile({
    stream,
    destination: args.destination,
    expected: args.archive,
    onProgress: args.onProgress,
  })
}

export async function releaseSessionExport(args: {
  sandbox: ArchiveUploadSandbox
  threadId: string
  path: string
}): Promise<void> {
  const path = exportedSessionPathOf({ path: args.path, threadId: args.threadId })
  const result = await args.sandbox.runCommand({ cmd: 'rm', args: ['-f', '--', path], timeoutMs: 120_000 })
  if (result.exitCode !== 0) throw new Error(`the session archive release exited ${result.exitCode}`)
}
