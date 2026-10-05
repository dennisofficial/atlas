import { createHash } from 'node:crypto'
import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { imagesDirectory } from '../../store/sessions/paths'

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

export type CachedImageSidecar = {
  sourcePath: string
  mediaType: string
  byteLength: number
  width?: number | undefined
  height?: number | undefined
  readAt: string
}

const exists = async (path: string): Promise<boolean> =>
  await access(path).then(
    () => true,
    () => false,
  )

export async function cacheReadImage(args: {
  sessionDir: string
  bytes: Uint8Array
  mediaType: string
  sourcePath: string
  width?: number | undefined
  height?: number | undefined
}): Promise<{ cachePath: string; hash: string } | undefined> {
  try {
    const hash = createHash('sha256').update(args.bytes).digest('hex')
    const extension = EXTENSION_BY_MEDIA_TYPE[args.mediaType] ?? '.bin'
    const directory = imagesDirectory({ sessionDir: args.sessionDir })
    const cachePath = join(directory, `${hash}${extension}`)

    await mkdir(directory, { recursive: true, mode: 0o700 })

    if (!(await exists(cachePath))) {
      const temporary = `${cachePath}.tmp-${process.pid}`
      await writeFile(temporary, args.bytes)
      await rename(temporary, cachePath)
    }

    const sidecar: CachedImageSidecar = {
      sourcePath: args.sourcePath,
      mediaType: args.mediaType,
      byteLength: args.bytes.byteLength,
      width: args.width,
      height: args.height,
      readAt: new Date().toISOString(),
    }
    await writeFile(`${cachePath}.json`, `${JSON.stringify(sidecar, null, 2)}\n`)

    return { cachePath, hash }
  } catch {
    // Caching is a durability backstop on top of a read that already succeeded for the
    // model — never let a cache failure fail the read.
    return undefined
  }
}
