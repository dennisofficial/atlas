import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { TransferProgress } from './transfer-progress'

export async function downloadArchiveFile(args: {
  stream: NodeJS.ReadableStream
  destination: string
  expected?: { size: number; sha256: string } | undefined
  totalBytes?: number | undefined
  onProgress?: ((progress: TransferProgress) => void) | undefined
}): Promise<void> {
  await mkdir(dirname(args.destination), { recursive: true })
  const staging = `${args.destination}.${randomBytes(6).toString('hex')}.partial`
  const digest = createHash('sha256')
  const totalBytes = args.expected?.size ?? args.totalBytes
  const report = (progress: { transferredBytes: number; complete: boolean }): void =>
    args.onProgress?.({ ...progress, totalBytes })
  let size = 0
  report({ transferredBytes: size, complete: false })
  const verified = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += bytes.byteLength
      if (args.expected !== undefined && size > args.expected.size) {
        callback(new Error('the session archive exceeds its declared size'))
        return
      }
      digest.update(bytes)
      report({ transferredBytes: size, complete: false })
      callback(null, bytes)
    },
  })
  try {
    await pipeline(args.stream, verified, createWriteStream(staging, { mode: 0o600, flags: 'wx' }))
    const sha256 = digest.digest('hex')
    if (args.expected !== undefined && (size !== args.expected.size || sha256 !== args.expected.sha256)) {
      throw new Error('the session archive size or checksum does not match its export descriptor')
    }
    if (args.expected === undefined && args.totalBytes !== undefined && size !== args.totalBytes) {
      throw new Error(`the workspace archive download ended at ${size} of ${args.totalBytes} bytes`)
    }
    await rename(staging, args.destination)
    report({ transferredBytes: size, complete: true })
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}
