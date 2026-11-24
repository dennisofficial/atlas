import type { DigestFileResult } from '@dltech/atlas-protocol'

export const HEAD_BYTES = 8192

export const digestFile = async (args: { path: string }): Promise<DigestFileResult> => {
  const hasher = new Bun.CryptoHasher('sha256')
  const head: Uint8Array[] = []
  let headLength = 0
  let size = 0
  for await (const chunk of Bun.file(args.path).stream()) {
    hasher.update(chunk)
    size += chunk.length
    if (headLength < HEAD_BYTES) {
      const part = chunk.subarray(0, HEAD_BYTES - headLength)
      head.push(part)
      headLength += part.length
    }
  }
  return {
    sha256: hasher.digest('hex'),
    size,
    head: Buffer.concat(head).toString('base64'),
  }
}
