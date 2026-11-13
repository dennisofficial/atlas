import { FileSystemPort, type FileStat, type FileSystemEntry } from '@dltech/atlas-core'
import type { ArtifactSummary, ArtifactUpload } from '@dltech/atlas-wire'

import {
  ArtifactPort,
  type ArtifactEntryInput,
  type ArtifactPublishBegun,
  type ArtifactPublishCommitted,
  type ArtifactSourceExport,
} from '../../../artifacts/artifact-port'

export class FakeArtifactPort extends ArtifactPort {
  readonly beginCalls: {
    subdomain?: string | undefined
    name?: string | undefined
    entries: ArtifactEntryInput[]
  }[] = []
  readonly commitCalls: { artifactId: string; version: number; spec: unknown }[] = []
  readonly unpublishCalls: string[] = []
  readonly beginUploads: ArtifactUpload[] = []
  artifacts: readonly ArtifactSummary[] = []
  sourceEntries: { path: string; url: string }[] = []
  failure: Error | null = null

  async beginPublish(args: {
    subdomain?: string | undefined
    name?: string | undefined
    entries: ArtifactEntryInput[]
  }): Promise<ArtifactPublishBegun> {
    this.guard()
    this.beginCalls.push(args)
    return {
      artifactId: 'art_1',
      subdomain: args.subdomain ?? 'demo',
      version: 3,
      uploads:
        this.beginUploads.length > 0
          ? this.beginUploads
          : args.entries.map((entry) => ({
              path: entry.path,
              tree: entry.tree,
              sha256: entry.sha256,
              url: `https://upload.test/${entry.path}`,
            })),
    }
  }

  async commitPublish(args: {
    artifactId: string
    version: number
    spec: unknown
  }): Promise<ArtifactPublishCommitted> {
    this.guard()
    this.commitCalls.push(args)
    return {
      subdomain: 'demo',
      version: args.version,
      url: 'https://demo.artifacts.test',
      status: 'building',
    }
  }

  async list(): Promise<readonly ArtifactSummary[]> {
    this.guard()
    return this.artifacts
  }

  async sourceExport(): Promise<ArtifactSourceExport> {
    this.guard()
    return { entries: this.sourceEntries }
  }

  async unpublish(args: { subdomain: string }): Promise<void> {
    this.guard()
    this.unpublishCalls.push(args.subdomain)
  }

  private guard(): void {
    if (this.failure !== null) throw this.failure
  }
}

const statOf = (size: number): FileStat => ({
  size,
  mode: 0,
  mtimeMs: 0,
  isFile: () => true,
  isDirectory: () => false,
})

export class FakeFiles extends FileSystemPort {
  readonly files = new Map<string, Uint8Array>()
  readonly directories = new Set<string>()

  put(path: string, content: string | Uint8Array): void {
    this.files.set(path, typeof content === 'string' ? new TextEncoder().encode(content) : content)
  }

  text(path: string): string | undefined {
    const bytes = this.files.get(path)
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes)
  }

  async stat(args: { path: string }): Promise<FileStat> {
    const bytes = this.files.get(args.path)
    if (bytes === undefined) throw new Error(`ENOENT: ${args.path}`)
    return statOf(bytes.byteLength)
  }

  async readLink(): Promise<string | null> {
    return null
  }

  async readFile(args: { path: string }): Promise<string> {
    const bytes = this.files.get(args.path)
    if (bytes === undefined) throw new Error(`ENOENT: ${args.path}`)
    return new TextDecoder().decode(bytes)
  }

  async readBytes(args: { path: string }): Promise<Uint8Array> {
    const bytes = this.files.get(args.path)
    if (bytes === undefined) throw new Error(`ENOENT: ${args.path}`)
    return bytes
  }

  async readTextForEdit(args: { path: string }): Promise<{ text: string; strict: string | null }> {
    const text = await this.readFile(args)
    return { text, strict: text }
  }

  async writeFile(args: { path: string; content: string | Uint8Array }): Promise<void> {
    this.put(args.path, args.content)
  }

  async removeFile(args: { path: string }): Promise<void> {
    this.files.delete(args.path)
  }

  async mkdir(args: { path: string }): Promise<void> {
    this.directories.add(args.path)
  }

  async rename(args: { from: string; to: string }): Promise<void> {
    const bytes = this.files.get(args.from)
    if (bytes === undefined) throw new Error(`ENOENT: ${args.from}`)
    this.files.delete(args.from)
    this.files.set(args.to, bytes)
  }

  async readDirectory(args: { path: string }): Promise<readonly FileSystemEntry[]> {
    const prefix = args.path.endsWith('/') ? args.path : `${args.path}/`
    const names = new Set<string>()
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const [head] = rest.split('/')
      if (head !== undefined && head.length > 0) names.add(head)
    }
    if (names.size === 0 && !this.directories.has(args.path))
      throw new Error(`ENOENT: ${args.path}`)
    return [...names].map((name) => ({
      name,
      isFile: () => true,
      isDirectory: () => false,
    }))
  }

  async glob(): Promise<readonly string[]> {
    return [...this.files.keys()]
  }
}

export class FakeProcesses {
  readonly commands: (readonly string[])[] = []
  stdout = ''
  exitCode = 0
  stderr = ''

  spawn(args: { cmd: readonly string[] }) {
    this.commands.push(args.cmd)
    const encode = (text: string): ReadableStream<Uint8Array> =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text))
          controller.close()
        },
      })
    return {
      stdout: encode(this.stdout),
      stderr: encode(this.stderr),
      exited: Promise.resolve(this.exitCode),
      terminate: () => undefined,
    }
  }

  which(): string | null {
    return null
  }

  gitListing(paths: readonly string[]): void {
    this.stdout = paths.map((path) => `${path}\0`).join('')
  }
}
