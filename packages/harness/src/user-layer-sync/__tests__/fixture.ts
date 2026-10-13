import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { LogPort, type LogEntry } from '@dltech/atlas-core'

import { UserFileConflict, type UserFileContent, type UserFileMeta } from '../../cloud/user-files-client'
import type { UserLayerSyncClient } from '../client'
import { createUserLayerSync } from '../factory'
import { sha256Hex } from '../local-file'

type Row = { revision: number; contentHash: string; content: Uint8Array | null; tombstonedAt: string | null }

export class FakeUserFilesServer {
  readonly rows = new Map<string, Row>()
  readonly puts: string[] = []

  private key(args: { tree: string; path: string }): string {
    return `${args.tree}\0${args.path}`
  }

  row(args: { tree: string; path: string }): Row | undefined {
    return this.rows.get(this.key(args))
  }

  text(args: { tree: string; path: string }): string | undefined {
    const content = this.row(args)?.content
    return content === null || content === undefined ? undefined : Buffer.from(content).toString('utf8')
  }

  clientFor(): UserLayerSyncClient {
    return {
      listUserFiles: async (args) => {
        const files: UserFileMeta[] = []
        for (const [key, row] of this.rows) {
          const [tree, path] = key.split('\0')
          if (tree !== args.tree || path === undefined) continue
          files.push({ path, revision: row.revision, contentHash: row.contentHash, tombstonedAt: row.tombstonedAt })
        }
        return files
      },
      getUserFiles: async (args) =>
        args.paths.flatMap((path): UserFileContent[] => {
          const row = this.row({ tree: args.tree, path })
          if (row === undefined) return []
          return [{ path, revision: row.revision, contentHash: row.contentHash, tombstonedAt: row.tombstonedAt, content: row.content }]
        }),
      putUserFile: async (args) => {
        const existing = this.row(args)
        this.assertBase({ existing, baseRevision: args.baseRevision })
        this.puts.push(`${args.tree}/${args.path}`)
        const revision = args.baseRevision + 1
        this.rows.set(this.key(args), { revision, contentHash: args.contentHash, content: args.content, tombstonedAt: null })
        return { revision }
      },
      deleteUserFile: async (args) => {
        const existing = this.row(args)
        this.assertBase({ existing, baseRevision: args.baseRevision })
        const revision = args.baseRevision + 1
        this.rows.set(this.key(args), { revision, contentHash: '', content: null, tombstonedAt: new Date().toISOString() })
        return { revision }
      },
    }
  }

  private assertBase(args: { existing: Row | undefined; baseRevision: number }): void {
    const currentRevision = args.existing?.revision ?? 0
    if (currentRevision === args.baseRevision) return
    throw new UserFileConflict({ currentRevision, contentHash: args.existing?.contentHash ?? '' })
  }
}

export class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

export const scratchDirectory = (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), `${prefix}-`))

export async function writeAt(args: { path: string; content: string }): Promise<void> {
  await mkdir(dirname(args.path), { recursive: true })
  await writeFile(args.path, args.content, 'utf8')
}

export const readAt = (path: string): Promise<string> => readFile(path, 'utf8')

export const namesIn = (directory: string): Promise<string[]> => readdir(directory).then((names) => names.sort())

export type Device = {
  atlasHome: string
  home: string
  log: RecordingLog
  engine: ReturnType<typeof createUserLayerSync>
  client: UserLayerSyncClient
  deviceId: () => Promise<string>
}

export async function makeDevice(args: {
  server: FakeUserFilesServer
  name: string
  client?: UserLayerSyncClient
  debounceMs?: number
}): Promise<Device> {
  const root = await scratchDirectory(`atlas-ulsync-${args.name}`)
  const atlasHome = join(root, 'atlas-home')
  const home = join(root, 'home')
  await mkdir(atlasHome, { recursive: true })
  await mkdir(home, { recursive: true })
  const log = new RecordingLog()
  const client = args.client ?? args.server.clientFor()
  const engine = createUserLayerSync({ atlasHome, home, client, log, debounceMs: args.debounceMs ?? 20 })
  const deviceId = async (): Promise<string> =>
    (JSON.parse(await readAt(join(atlasHome, 'sync', 'user-layer-sync.json'))) as { deviceId: string }).deviceId
  return { atlasHome, home, log, engine, client, deviceId }
}

export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('condition not met in time')
}

export const hashOf = sha256Hex
