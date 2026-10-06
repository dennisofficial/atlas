import { join } from 'node:path'

import { materializeContext } from '../materialize-context'
import type { WorkspaceFiles } from '../workspace-files'
import type { WorkspaceSpec } from '../workspace-spec'

export const ATLAS_HOME = '/srv/atlas-home'
export const CWD = '/srv/workspace'
export const LEGACY_HOME = '/srv/legacy-home'

export const SPEC: WorkspaceSpec = {
  remoteUrl: null,
  branch: null,
  commit: null,
  patch: '',
  githubToken: null,
  contextBundle: null,
}

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

export const CONTEXT_STAMP_PATH = join(ATLAS_HOME, 'context.stamp')

export const bundle = (entries: Record<string, string>): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(entries).map(([path, text]) => [path, Buffer.from(text, 'utf8').toString('base64')]),
    ),
  )

export const materialize = (args: { spec: WorkspaceSpec; files: WorkspaceFiles }) =>
  materializeContext({
    fetchSpec: async () => args.spec,
    atlasHome: ATLAS_HOME,
    cwd: CWD,
    home: LEGACY_HOME,
    files: args.files,
  })
