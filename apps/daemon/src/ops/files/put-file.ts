import { stat } from 'node:fs/promises'

import type { PutFileOp, PutFileResult } from '@dltech/atlas-protocol'

const ERROR_BODY_CHARS = 200

const counted = (args: {
  hasher: Bun.CryptoHasher
  counter: { size: number }
}): TransformStream<Uint8Array, Uint8Array> =>
  new TransformStream({
    transform: (chunk, controller) => {
      args.hasher.update(chunk)
      args.counter.size += chunk.length
      controller.enqueue(chunk)
    },
  })

const failureOf = async (response: Response): Promise<Error> => {
  const body = await response.text().catch(() => '')
  return new Error(
    `putting the file failed with status ${response.status}: ${body.slice(0, ERROR_BODY_CHARS)}`,
  )
}

export const putFile = async (args: {
  op: PutFileOp
  signal: AbortSignal
}): Promise<PutFileResult> => {
  const { op, signal } = args
  const info = await stat(op.path)
  const hasher = new Bun.CryptoHasher('sha256')
  const counter = { size: 0 }
  const body = Bun.file(op.path).stream().pipeThrough(counted({ hasher, counter }))
  const init: RequestInit & { duplex: 'half' } = {
    method: 'PUT',
    body,
    duplex: 'half',
    signal,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(info.size),
    },
  }
  const response = await fetch(op.url, init)
  if (!response.ok) throw await failureOf(response)
  return { sha256: hasher.digest('hex'), size: counter.size }
}
