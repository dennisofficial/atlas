import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export type ExampleFile = { threadId: string; path: string }

export const sortedNames = (names: readonly string[]): string[] => [...names].sort()

async function listDirectory({ path }: { path: string }) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return []
  }
}

async function listJsonFiles({ dir }: { dir: string }): Promise<string[]> {
  const entries = await listDirectory({ path: dir })
  const found: string[] = []
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await listJsonFiles({ dir: path })))
    if (entry.isFile() && entry.name.endsWith('.json')) found.push(path)
  }
  return found
}

export async function assertSessionDirExists({ sessionDir }: { sessionDir: string }): Promise<void> {
  const exists = await access(sessionDir).then(
    () => true,
    () => false,
  )
  if (!exists) throw new Error(`session directory does not exist: ${sessionDir}`)
}

export async function listExampleFiles({ sessionDir }: { sessionDir: string }): Promise<readonly ExampleFile[]> {
  await assertSessionDirExists({ sessionDir })
  const threads = await listDirectory({ path: join(sessionDir, 'threads') })
  const threadIds = sortedNames(threads.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
  const files: ExampleFile[] = []
  for (const threadId of threadIds) {
    const paths = await listJsonFiles({ dir: join(sessionDir, 'threads', threadId, 'quality', 'examples') })
    for (const path of paths) files.push({ threadId, path })
  }
  return files
}
