import {
  chmod as nodeChmod,
  mkdir as nodeMkdir,
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  readlink as nodeReadlink,
  rename as nodeRename,
  stat as nodeStat,
  unlink as nodeUnlink,
  writeFile as nodeWriteFile,
} from 'node:fs/promises'

import { FileSystemPort, type FileStat, type FileSystemEntry } from '@dltech/atlas-core'

import { walkGlob } from './walk-glob'

const strictDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

const decodeStrict = ({ bytes }: { bytes: Uint8Array }): string | null => {
  try {
    return strictDecoder.decode(bytes)
  } catch {
    return null
  }
}

export class LocalFileSystemPort implements FileSystemPort {
  stat(args: { path: string }): Promise<FileStat> {
    return nodeStat(args.path)
  }

  async readLink(args: { path: string }): Promise<string | null> {
    return await nodeReadlink(args.path).catch(() => null)
  }

  readFile(args: { path: string }): Promise<string> {
    return nodeReadFile(args.path, 'utf8')
  }

  async readBytes(args: { path: string }): Promise<Uint8Array> {
    return await nodeReadFile(args.path)
  }

  async readTextForEdit(args: { path: string }): Promise<{ text: string; strict: string | null }> {
    const bytes = await nodeReadFile(args.path)
    return { text: bytes.toString('utf8'), strict: decodeStrict({ bytes }) }
  }

  async writeFile(args: { path: string; content: string; mode?: number }): Promise<void> {
    await nodeWriteFile(args.path, args.content, { encoding: 'utf8', ...(args.mode === undefined ? {} : { mode: args.mode }) })
    if (args.mode !== undefined) await nodeChmod(args.path, args.mode)
  }

  async removeFile(args: { path: string }): Promise<void> {
    await nodeUnlink(args.path)
  }

  async mkdir(args: { path: string }): Promise<void> {
    await nodeMkdir(args.path, { recursive: true })
  }

  async rename(args: { from: string; to: string }): Promise<void> {
    await nodeRename(args.from, args.to)
  }

  readDirectory(args: { path: string }): Promise<readonly FileSystemEntry[]> {
    return nodeReaddir(args.path, { withFileTypes: true })
  }

  async glob(args: {
    pattern: string
    cwd: string
    dot?: boolean
    signal?: AbortSignal
  }): Promise<readonly string[]> {
    return await walkGlob({
      pattern: args.pattern,
      cwd: args.cwd,
      dot: args.dot ?? false,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
  }
}
