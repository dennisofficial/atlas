import type { WorkspaceFiles } from '../workspace-files'

export const ATLAS_HOME = '/srv/atlas-home'

export const fakeFiles = () => {
  const written = new Map<string, string>()
  const writtenBytes = new Map<string, Buffer>()
  const stamped = new Map<string, string>()
  const files: WorkspaceFiles = {
    exists: async (path) => stamped.has(path) || writtenBytes.has(path),
    read: async (path) => {
      const text = stamped.get(path)
      if (text === undefined) throw new Error(`no such file: ${path}`)
      return text
    },
    write: async ({ path, text }) => {
      stamped.set(path, text)
    },
    writeBytes: async ({ path, bytes, overwrite }) => {
      if (overwrite === false && writtenBytes.has(path)) return
      writtenBytes.set(path, bytes)
      written.set(path, bytes.toString('utf8'))
    },
    ensureDirectory: async () => undefined,
    empty: async () => undefined,
  }
  return { files, written, writtenBytes, stamped }
}
