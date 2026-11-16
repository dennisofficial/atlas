import { join } from 'node:path'

import { sha256Hex } from '@dltech/atlas-artifacts'
import type { ArtifactUpload } from '@dltech/atlas-wire'

import type { ProcessPort, FileSystemPort } from '@dltech/atlas-core'

import type { PlannedFile } from '../../artifacts/artifact-publish-plan'

const UPLOAD_CONCURRENCY = 8

export type Hashed = PlannedFile & { bytes: Uint8Array }

async function readNulSeparated(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const text = new TextDecoder().decode(await new Response(stream).arrayBuffer())
  return text.split('\0').filter((path) => path.length > 0)
}

export async function listGitPaths(args: {
  dir: string
  processes: ProcessPort
}): Promise<string[]> {
  const handle = args.processes.spawn({
    cmd: ['git', '-C', args.dir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    cwd: args.dir,
  })
  const [paths, code, stderr] = await Promise.all([
    readNulSeparated(handle.stdout),
    handle.exited,
    new Response(handle.stderr).text(),
  ])
  if (code !== 0) {
    throw new Error(
      `Pushing needs a git worktree: \`git ls-files\` failed in ${args.dir} with ${code}. ${stderr.trim()}`,
    )
  }
  return paths
}

export async function hashOf(args: {
  dir: string
  paths: readonly string[]
  files: FileSystemPort
}): Promise<Hashed[]> {
  return await Promise.all(
    args.paths.map(async (path) => {
      const bytes = await args.files.readBytes({ path: join(args.dir, path) })
      return { path, sha256: sha256Hex(bytes), size: bytes.byteLength, bytes }
    }),
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

export async function putUploads(args: {
  uploads: readonly ArtifactUpload[]
  hashed: readonly Hashed[]
  fetchFn: ArtifactUploadFetch
}): Promise<void> {
  const bodies = new Map(args.hashed.map((file) => [file.path, file.bytes]))
  const queue = [...args.uploads]
  const worker = async (): Promise<void> => {
    for (;;) {
      const upload = queue.shift()
      if (upload === undefined) return
      const body = bodies.get(upload.path)
      if (body === undefined)
        throw new Error(`the server asked for ${upload.path}, which was not read`)
      await putOne({ upload, body, fetchFn: args.fetchFn })
    }
  }
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker))
}
