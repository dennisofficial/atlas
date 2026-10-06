import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'

export type ArchiveFileDescription = { size: number; sha256: string }

export type SessionArchiveFile = ArchiveFileDescription & {
  path: string
  dispose: () => Promise<void>
}

export async function describeArchiveFile(args: { path: string }): Promise<ArchiveFileDescription> {
  const digest = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(args.path)) {
    const bytes: Buffer = chunk
    digest.update(bytes)
    size += bytes.length
  }
  return { size, sha256: digest.digest('hex') }
}

export async function openArchiveFile(args: {
  path: string
  disposeTarget: string
}): Promise<SessionArchiveFile> {
  const description = await describeArchiveFile({ path: args.path })
  return {
    path: args.path,
    ...description,
    dispose: () => rm(args.disposeTarget, { recursive: true, force: true }),
  }
}
