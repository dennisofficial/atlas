import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { FetchToFileOp } from '@dltech/atlas-protocol'

export const fetchToFile = async (args: {
  op: FetchToFileOp
  signal: AbortSignal
}): Promise<void> => {
  const { op, signal } = args
  const part = `${op.path}.part`
  await mkdir(dirname(op.path), { recursive: true })
  try {
    const response = await fetch(op.url, { signal })
    if (!response.ok || response.body === null) {
      throw new Error(`fetching ${op.path} failed with status ${response.status}`)
    }
    await Bun.write(part, response)
    const written = (await stat(part)).size
    if (written !== op.size) {
      throw Object.assign(new Error(`fetched ${written} bytes, expected ${op.size}`), {
        code: 'EINVAL',
      })
    }
    await rename(part, op.path)
  } catch (error) {
    await rm(part, { force: true })
    throw error
  }
}
