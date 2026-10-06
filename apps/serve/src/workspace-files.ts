import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type WorkspaceFiles = {
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (args: { path: string; text: string }) => Promise<void>
  writeBytes: (args: { path: string; bytes: Buffer; overwrite?: boolean | undefined }) => Promise<void>
  ensureDirectory: (path: string) => Promise<void>
  empty: (path: string) => Promise<void>
}

export const hasErrorCode = (args: { error: unknown; code: string }): boolean =>
  args.error instanceof Error && 'code' in args.error && args.error.code === args.code

export const nodeWorkspaceFiles: WorkspaceFiles = {
  exists: async (path) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },

  read: async (path) => readFile(path, 'utf8'),

  write: async ({ path, text }) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text, 'utf8')
  },

  writeBytes: async ({ path, bytes, overwrite }) => {
    await mkdir(dirname(path), { recursive: true })
    if (overwrite !== false) {
      await writeFile(path, bytes)
      return
    }
    try {
      await writeFile(path, bytes, { flag: 'wx' })
    } catch (error) {
      if (!hasErrorCode({ error, code: 'EEXIST' })) throw error
    }
  },

  ensureDirectory: async (path) => {
    await mkdir(path, { recursive: true })
  },

  empty: async (path) => {
    await mkdir(path, { recursive: true })
    for (const entry of await readdir(path)) {
      await rm(join(path, entry), { recursive: true, force: true })
    }
  },
}
