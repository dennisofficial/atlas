import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export async function downloadArchiveFile(args: {
  stream: NodeJS.ReadableStream
  destination: string
  expected?: { size: number; sha256: string } | undefined
}): Promise<void> {
  await mkdir(dirname(args.destination), { recursive: true })
  const staging = `${args.destination}.${randomBytes(6).toString('hex')}.partial`
  const digest = createHash('sha256')
  let size = 0
  const verified = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength
      if (args.expected !== undefined && size > args.expected.size) {
        callback(new Error('the session archive exceeds its declared size'))
        return
      }
      digest.update(chunk)
      callback(null, chunk)
    },
  })
  try {
    await pipeline(args.stream, verified, createWriteStream(staging, { mode: 0o600, flags: 'wx' }))
    const sha256 = digest.digest('hex')
    if (args.expected !== undefined && (size !== args.expected.size || sha256 !== args.expected.sha256)) {
      throw new Error('the session archive size or checksum does not match its export descriptor')
    }
    await rename(staging, args.destination)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}
