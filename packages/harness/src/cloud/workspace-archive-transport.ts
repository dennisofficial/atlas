import { createHash, randomBytes } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { posix } from 'node:path'

import { WORKSPACE_EXPORT_DIRECTORY_NAME, WORKSPACE_EXPORT_FILE_PATTERN } from '@dltech/atlas-wire'

import { DRIVE_HOME_PATH } from './drive-names'
import { downloadArchiveFile } from './archive-download'

export const WORKSPACE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024
export const WORKSPACE_UPLOAD_BATCH_PARTS = 8
export const WORKSPACE_EXPORT_DIRECTORY = `${DRIVE_HOME_PATH}/${WORKSPACE_EXPORT_DIRECTORY_NAME}`

const COMMAND_TIMEOUT_MS = 120_000

export type ArchiveUploadSandbox = {
  writeFiles(files: { path: string; content: Uint8Array; mode?: number }[]): Promise<void>
  runCommand(params: {
    cmd: string
    args: string[]
    timeoutMs?: number
  }): Promise<{ exitCode: number }>
}

export type ArchiveDownloadSandbox = {
  readFile(file: { path: string }): Promise<NodeJS.ReadableStream | null>
}

const quoted = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

const runScript = async (args: { sandbox: ArchiveUploadSandbox; script: string }): Promise<void> => {
  const result = await args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `set -e; ${args.script}`],
    timeoutMs: COMMAND_TIMEOUT_MS,
  })
  if (result.exitCode !== 0) {
    throw new Error(`the workspace archive upload command exited ${result.exitCode}`)
  }
}

export const partPathFor = (args: { directory: string; index: number }): string =>
  `${args.directory}/part-${String(args.index).padStart(6, '0')}`

export async function uploadWorkspaceArchive(args: {
  sandbox: ArchiveUploadSandbox
  source: string
  destination: string
  chunkBytes?: number | undefined
  batchParts?: number | undefined
}): Promise<void> {
  const chunkBytes = args.chunkBytes ?? WORKSPACE_UPLOAD_CHUNK_BYTES
  const batchParts = args.batchParts ?? WORKSPACE_UPLOAD_BATCH_PARTS
  const expected = (await stat(args.source)).size
  const generation = randomBytes(6).toString('hex')
  const staging = `${args.destination}.${generation}.uploading`
  const parts = `${args.destination}.${generation}.parts`
  const digest = createHash('sha256')
  await runScript({
    sandbox: args.sandbox,
    script: `mkdir -p ${quoted(posix.dirname(args.destination))} ${quoted(parts)}; : > ${quoted(staging)}`,
  })

  const handle = await open(args.source, 'r')
  const buffer = Buffer.alloc(chunkBytes)
  let pending: string[] = []
  const flush = async (): Promise<void> => {
    if (pending.length === 0) return
    const names = pending.map(quoted).join(' ')
    await runScript({
      sandbox: args.sandbox,
      script: `cat ${names} >> ${quoted(staging)}; rm -f ${names}`,
    })
    pending = []
  }
  try {
    for (let index = 1; ; index += 1) {
      const { bytesRead } = await handle.read(buffer, 0, chunkBytes, null)
      if (bytesRead === 0) break
      const chunk = buffer.subarray(0, bytesRead)
      digest.update(chunk)
      const path = partPathFor({ directory: parts, index })
      await args.sandbox.writeFiles([{ path, content: chunk, mode: 0o600 }])
      pending.push(path)
      if (pending.length >= batchParts) await flush()
    }
    await flush()
    await runScript({
      sandbox: args.sandbox,
      script: `test "$(wc -c < ${quoted(staging)})" -eq ${expected}; test "$(sha256sum ${quoted(staging)} | cut -d' ' -f1)" = ${digest.digest('hex')}; mv -f ${quoted(staging)} ${quoted(args.destination)}; rmdir ${quoted(parts)}`,
    })
  } catch (error) {
    await runScript({
      sandbox: args.sandbox,
      script: `rm -rf ${quoted(parts)} ${quoted(staging)}`,
    }).catch(() => undefined)
    throw error
  } finally {
    await handle.close()
  }
}

export const exportedWorkspacePathOf = (path: string): string => {
  const normalized = posix.normalize(path)
  if (
    normalized !== path ||
    posix.dirname(normalized) !== WORKSPACE_EXPORT_DIRECTORY ||
    !WORKSPACE_EXPORT_FILE_PATTERN.test(posix.basename(normalized))
  ) {
    throw new Error(`refusing to download ${path}: it is not a workspace export`)
  }
  return normalized
}

export async function downloadWorkspaceArchive(args: {
  sandbox: ArchiveDownloadSandbox
  path: string
  destination: string
}): Promise<void> {
  const remote = exportedWorkspacePathOf(args.path)
  const stream = await args.sandbox.readFile({ path: remote })
  if (stream === null) throw new Error(`the sandbox holds no workspace export at ${remote}`)
  await downloadArchiveFile({ stream, destination: args.destination })
}

export async function releaseWorkspaceExport(args: {
  sandbox: ArchiveUploadSandbox
  path: string
}): Promise<void> {
  const remote = exportedWorkspacePathOf(args.path)
  await runScript({
    sandbox: args.sandbox,
    script: `rm -f ${quoted(remote)} ${quoted(`${remote}.partial`)}`,
  })
}
