import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type WorkspaceFiles = {
  exists: (path: string) => Promise<boolean>
  write: (args: { path: string; text: string }) => Promise<void>
  empty: (path: string) => Promise<void>
}

export const nodeWorkspaceFiles: WorkspaceFiles = {
  exists: async (path) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },

  write: async ({ path, text }) => {
    await writeFile(path, text, 'utf8')
  },

  /** Only ever reached before the sentinel exists, where whatever is there is a half-materialization. */
  empty: async (path) => {
    await mkdir(path, { recursive: true })
    for (const entry of await readdir(path)) {
      await rm(join(path, entry), { recursive: true, force: true })
    }
  },
}
