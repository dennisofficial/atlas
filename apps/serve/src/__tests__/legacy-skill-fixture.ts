import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { buildContextArchive } from '@dltech/atlas-harness'

import type { ArchiveRetry } from '../context-archive-retry'
import { materializeContext } from '../materialize-context'
import type { WorkspaceFiles } from '../workspace-files'
import type { FetchContextArchive, WorkspaceSpec } from '../workspace-spec'

export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x01])

export const LEGACY_STAMP = { projectDirectory: '/Users/dennis/dev/atlas', identity: 'github.com/dennisofficial/atlas' }

const NO_WAIT: ArchiveRetry = { attempts: 1, sleep: async () => undefined }

export type Scratch = {
  root: string
  atlasHome: string
  legacyHome: string
  cwd: string
  put: (args: { path: string; content: string | Buffer }) => Promise<void>
  readText: (path: string) => Promise<string>
  cleanup: () => Promise<void>
}

export const makeScratch = async (): Promise<Scratch> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-legacy-skills-'))
  const put = async (args: { path: string; content: string | Buffer }) => {
    await mkdir(dirname(args.path), { recursive: true })
    await writeFile(args.path, args.content)
  }
  return {
    root,
    atlasHome: join(root, 'atlas-home'),
    legacyHome: join(root, 'legacy-home'),
    cwd: join(root, 'workspace'),
    put,
    readText: (path) => readFile(path, 'utf8'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

export const archiveOf = async (args: {
  scratch: Scratch
  entries: Record<string, string | Buffer>
}): Promise<Uint8Array> => {
  const staging = join(args.scratch.root, 'archive-staging')
  const files = []
  for (const [key, content] of Object.entries(args.entries)) {
    const path = join(staging, key)
    await args.scratch.put({ path, content })
    files.push({ key, path })
  }
  const archive = await buildContextArchive({ files })
  if (archive === undefined) throw new Error('expected an archive')
  return archive
}

export const writeLegacyStamp = (args: { scratch: Scratch; extra?: Record<string, unknown> | undefined }) =>
  args.scratch.put({
    path: join(args.scratch.atlasHome, 'context.stamp'),
    content: JSON.stringify({ ...LEGACY_STAMP, ...args.extra }),
  })

export const recover = (args: {
  scratch: Scratch
  archive?: Uint8Array | null | (() => Promise<Uint8Array | null>)
  contextBundle?: string | null
  files?: WorkspaceFiles
  onSpec?: () => void
}) => {
  const { archive } = args
  const fetchArchive: FetchContextArchive | undefined =
    archive === undefined ? undefined : typeof archive === 'function' ? archive : async () => archive
  const spec: WorkspaceSpec = {
    remoteUrl: null,
    branch: null,
    commit: null,
    patch: '',
    githubToken: null,
    contextBundle: args.contextBundle ?? null,
  }
  return materializeContext({
    fetchSpec: async () => {
      args.onSpec?.()
      return spec
    },
    fetchArchive,
    archiveRetry: NO_WAIT,
    atlasHome: args.scratch.atlasHome,
    cwd: args.scratch.cwd,
    home: args.scratch.legacyHome,
    files: args.files,
  })
}

export const stampOf = async (scratch: Scratch): Promise<Record<string, unknown>> =>
  JSON.parse(await scratch.readText(join(scratch.atlasHome, 'context.stamp')))
