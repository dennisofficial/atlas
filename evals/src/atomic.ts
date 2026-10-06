import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function writeFileAtomic({ path, content }: { path: string; content: string }): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}

export async function writeJsonAtomic({ path, value }: { path: string; value: unknown }): Promise<void> {
  await writeFileAtomic({ path, content: `${JSON.stringify(value, null, 2)}\n` })
}
