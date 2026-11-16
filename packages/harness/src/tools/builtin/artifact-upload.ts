import { join } from 'node:path'

import { isHardExcluded, sha256Hex } from '@dltech/atlas-artifacts'
import type { ArtifactUpload } from '@dltech/atlas-wire'

import type { ProcessPort, FileSystemEntry, FileSystemPort } from '@dltech/atlas-core'

import type { ArtifactFile } from '../../artifacts/artifact-publish-plan'

const UPLOAD_CONCURRENCY = 8

type GitRun = { output: string; exitCode: number; stderr: string }

async function runGit(args: {
  dir: string
  rest: readonly string[]
  processes: ProcessPort
}): Promise<GitRun> {
  const handle = args.processes.spawn({
    cmd: ['git', '-C', args.dir, ...args.rest],
    cwd: args.dir,
  })
  const [output, exitCode, stderr] = await Promise.all([
    new Response(handle.stdout).text(),
    handle.exited,
    new Response(handle.stderr).text(),
  ])
  return { output, exitCode, stderr }
}

const splitNul = (text: string): string[] => text.split('\0').filter((path) => path.length > 0)

export async function ensureGitWorktree(args: {
  dir: string
  processes: ProcessPort
}): Promise<boolean> {
  const inside = await runGit({
    dir: args.dir,
    rest: ['rev-parse', '--is-inside-work-tree'],
    processes: args.processes,
  })
  if (inside.exitCode === 0) return false

  const init = await runGit({ dir: args.dir, rest: ['init', '-q'], processes: args.processes })
  if (init.exitCode !== 0) {
    throw new Error(
      `Pushing needs a directory git can list, and \`git init -q\` failed in ${args.dir} with ${init.exitCode}. ${init.stderr.trim()}`,
    )
  }
  return true
}

export async function listGitPaths(args: {
  dir: string
  processes: ProcessPort
}): Promise<{ paths: string[]; initialised: boolean }> {
  const initialised = await ensureGitWorktree(args)
  const listing = await runGit({
    dir: args.dir,
    rest: ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    processes: args.processes,
  })
  if (listing.exitCode !== 0) {
    throw new Error(
      `\`git ls-files\` could not list the files in ${args.dir} with ${listing.exitCode}. ${listing.stderr.trim()}`,
    )
  }
  return { paths: splitNul(listing.output), initialised }
}

const readOf = async (args: {
  directory: string
  path: string
  tree: ArtifactFile['tree']
  files: FileSystemPort
}): Promise<ArtifactFile> => {
  const bytes = await args.files.readBytes({ path: join(args.directory, args.path) })
  return {
    path: args.path,
    tree: args.tree,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
    bytes,
  }
}

export async function hashOf(args: {
  dir: string
  paths: readonly string[]
  files: FileSystemPort
}): Promise<ArtifactFile[]> {
  return await Promise.all(
    args.paths.map(
      async (path) => await readOf({ directory: args.dir, path, tree: 'src', files: args.files }),
    ),
  )
}

async function walkOutput(args: {
  directory: string
  prefix: string
  files: FileSystemPort
}): Promise<string[]> {
  let entries: readonly FileSystemEntry[]
  try {
    entries = await args.files.readDirectory({ path: args.directory })
  } catch (error) {
    if (args.prefix.length === 0) return []
    throw error
  }

  const found: string[] = []
  for (const entry of entries) {
    const path = args.prefix.length === 0 ? entry.name : `${args.prefix}/${entry.name}`
    if (isHardExcluded({ path })) continue
    if (entry.isDirectory()) {
      const nested = await walkOutput({
        directory: join(args.directory, entry.name),
        prefix: path,
        files: args.files,
      })
      found.push(...nested)
      continue
    }
    if (entry.isFile()) found.push(path)
  }
  return found
}

export async function collectOutput(args: {
  dir: string
  outDir: string
  files: FileSystemPort
}): Promise<ArtifactFile[]> {
  const directory = join(args.dir, args.outDir)
  const paths = await walkOutput({ directory, prefix: '', files: args.files })
  return await Promise.all(
    paths.map(async (path) => await readOf({ directory, path, tree: 'dist', files: args.files })),
  )
}

export const defaultUploadFetch: ArtifactUploadFetch = async (url, init) => {
  const body = new ArrayBuffer(init.body.byteLength)
  new Uint8Array(body).set(init.body)
  return fetch(url, { method: init.method, body })
}

export type ArtifactUploadFetch = (
  url: string,
  init: { method: 'PUT'; body: Uint8Array },
) => Promise<{ ok: boolean; status: number }>

async function putOne(args: {
  upload: ArtifactUpload
  body: Uint8Array
  fetchFn: ArtifactUploadFetch
}) {
  const response = await args.fetchFn(args.upload.url, { method: 'PUT', body: args.body })
  if (!response.ok) {
    throw new Error(`uploading ${args.upload.path} failed with HTTP ${response.status}`)
  }
}

const keyOf = (args: { tree: string; path: string }): string => `${args.tree}\0${args.path}`

const bodyFor = (args: {
  upload: ArtifactUpload
  bodies: Map<string, Uint8Array>
}): Uint8Array | undefined => {
  const exact = args.bodies.get(keyOf({ tree: args.upload.tree, path: args.upload.path }))
  if (exact !== undefined) return exact
  if (args.upload.tree === 'dist') {
    return args.bodies.get(keyOf({ tree: 'src', path: args.upload.path }))
  }
  return undefined
}

export async function putUploads(args: {
  uploads: readonly ArtifactUpload[]
  files: readonly ArtifactFile[]
  fetchFn: ArtifactUploadFetch
}): Promise<void> {
  const bodies = new Map(
    args.files.map((file) => [keyOf({ tree: file.tree, path: file.path }), file.bytes]),
  )
  const queue = [...args.uploads]
  const worker = async (): Promise<void> => {
    for (;;) {
      const upload = queue.shift()
      if (upload === undefined) return
      const body = bodyFor({ upload, bodies })
      if (body === undefined)
        throw new Error(`the server asked for ${upload.path}, which was not read`)
      await putOne({ upload, body, fetchFn: args.fetchFn })
    }
  }
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker))
}
