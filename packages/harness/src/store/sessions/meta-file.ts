import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

let tmpSequence = 0

export async function writeMetaFile({
  file,
  meta,
}: {
  file: string
  meta: unknown
}): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  tmpSequence += 1
  const tmp = `${file}.${process.pid}.${tmpSequence}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(JSON.stringify(meta, null, 2))
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(tmp).catch(() => {})
    throw error
  }
  await handle.close()
  await rename(tmp, file)
}
