import { createHash, randomBytes } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { posix } from 'node:path'

import { WORKSPACE_EXPORT_DIRECTORY_NAME, WORKSPACE_EXPORT_FILE_PATTERN } from '@dltech/atlas-wire'

import { DRIVE_HOME_PATH } from './drive-names'
import { downloadArchiveFile } from './archive-download'
import type { TransferProgress } from './transfer-progress'

export const WORKSPACE_UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024
export const WORKSPACE_UPLOAD_BATCH_PARTS = 8
export const WORKSPACE_UPLOAD_CONCURRENCY = 8
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

export type ArchiveProgressReporter = (progress: TransferProgress) => void

export const partPathFor = (args: { directory: string; index: number }): string =>
  `${args.directory}/part-${String(args.index).padStart(6, '0')}`

export type ArchiveUploadArgs = {
  sandbox: ArchiveUploadSandbox
  source: string
  destination: string
  chunkBytes?: number | undefined
  batchParts?: number | undefined
  concurrency?: number | undefined
  onProgress?: ArchiveProgressReporter | undefined
}

const assertPositiveInteger = (args: { name: string; value: number }): void => {
  if (!Number.isInteger(args.value) || args.value < 1) {
    throw new Error(`${args.name} must be a positive integer, received ${args.value}`)
  }
}

type WaveChunk = { path: string; content: Uint8Array }

const writeWave = async (args: {
  sandbox: ArchiveUploadSandbox
  chunks: WaveChunk[]
  onAcknowledged: (bytes: number) => void
}): Promise<void> => {
  let failure: { error: unknown } | undefined
  await Promise.allSettled(
    args.chunks.map(async (chunk) => {
      try {
        await args.sandbox.writeFiles([{ path: chunk.path, content: chunk.content, mode: 0o600 }])
        args.onAcknowledged(chunk.content.byteLength)
      } catch (error) {
        failure ??= { error }
      }
    }),
  )
  if (failure !== undefined) throw failure.error
}

export async function uploadWorkspaceArchive(args: ArchiveUploadArgs): Promise<void> {
  const chunkBytes = args.chunkBytes ?? WORKSPACE_UPLOAD_CHUNK_BYTES
  const batchParts = args.batchParts ?? WORKSPACE_UPLOAD_BATCH_PARTS
  const concurrency = args.concurrency ?? WORKSPACE_UPLOAD_CONCURRENCY
  assertPositiveInteger({ name: 'chunkBytes', value: chunkBytes })
  assertPositiveInteger({ name: 'batchParts', value: batchParts })
  assertPositiveInteger({ name: 'concurrency', value: concurrency })
  const expected = (await stat(args.source)).size
  const report = (progress: { transferredBytes: number; complete: boolean }): void =>
    args.onProgress?.({ ...progress, totalBytes: expected })
  let acknowledged = 0
  report({ transferredBytes: acknowledged, complete: false })
  const generation = randomBytes(6).toString('hex')
  const staging = `${args.destination}.${generation}.uploading`
  const parts = `${args.destination}.${generation}.parts`
  const digest = createHash('sha256')
  await runScript({
    sandbox: args.sandbox,
    script: `mkdir -p ${quoted(posix.dirname(args.destination))} ${quoted(parts)}; : > ${quoted(staging)}`,
  })

  const handle = await open(args.source, 'r')
  const buffers: Buffer[] = []
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
    let index = 1
    for (let ended = false; !ended; ) {
      const waveSize = Math.min(concurrency, batchParts - pending.length)
      const chunks: WaveChunk[] = []
      while (chunks.length < waveSize) {
        const buffer = (buffers[chunks.length] ??= Buffer.alloc(chunkBytes))
        const { bytesRead } = await handle.read(buffer, 0, chunkBytes, null)
        if (bytesRead === 0) {
          ended = true
          break
        }
        const content = buffer.subarray(0, bytesRead)
        digest.update(content)
        chunks.push({ path: partPathFor({ directory: parts, index }), content })
        index += 1
      }
      await writeWave({
        sandbox: args.sandbox,
        chunks,
        onAcknowledged: (bytes) => {
          acknowledged += bytes
          report({ transferredBytes: acknowledged, complete: false })
        },
      })
      pending.push(...chunks.map((chunk) => chunk.path))
      if (pending.length >= batchParts) await flush()
    }
    await flush()
    await runScript({
      sandbox: args.sandbox,
      script: `test "$(wc -c < ${quoted(staging)})" -eq ${expected}; test "$(sha256sum ${quoted(staging)} | cut -d' ' -f1)" = ${digest.digest('hex')}; mv -f ${quoted(staging)} ${quoted(args.destination)}; rmdir ${quoted(parts)}`,
    })
    report({ transferredBytes: acknowledged, complete: true })
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

export type ArchiveDownloadArgs = {
  sandbox: ArchiveDownloadSandbox
  path: string
  destination: string
  totalBytes?: number | undefined
  onProgress?: ArchiveProgressReporter | undefined
}

export async function downloadWorkspaceArchive(args: ArchiveDownloadArgs): Promise<void> {
  const remote = exportedWorkspacePathOf(args.path)
  const stream = await args.sandbox.readFile({ path: remote })
  if (stream === null) throw new Error(`the sandbox holds no workspace export at ${remote}`)
  await downloadArchiveFile({
    stream,
    destination: args.destination,
    totalBytes: args.totalBytes,
    onProgress: args.onProgress,
  })
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
