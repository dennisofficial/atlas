import { join } from 'node:path'

import {
  AgentFileSystemPort,
  type FileStat,
  type FileSystemEntry,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

// A single execve argument string is capped at 32 pages (128 KiB) by the kernel's
// MAX_ARG_STRLEN, far below ARG_MAX, so base64 payload chunks must stay well under it.
// https://elixir.bootlin.com/linux/latest/source/include/uapi/linux/binfmts.h
const WRITE_CHUNK_BYTES = 64 * 1024

const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000

const decoder = new TextDecoder()

type ExecOutcome = {
  readonly stdout: Uint8Array
  readonly stderr: string
  readonly exitCode: number
}

export class RemoteFileError extends Error {
  readonly code: string | undefined

  constructor(args: { message: string; code?: string | undefined }) {
    super(args.message)
    this.name = 'RemoteFileError'
    this.code = args.code
  }
}

const errorCodeIn = (stderr: string): string | undefined => {
  if (stderr.includes('No such file or directory')) return 'ENOENT'
  if (stderr.includes('Not a directory')) return 'ENOTDIR'
  return undefined
}

const remoteStat = (args: {
  size: number
  mode: number
  mtimeMs: number
}): FileStat => ({
  size: args.size,
  mode: args.mode,
  mtimeMs: args.mtimeMs,
  isFile: () => (args.mode & S_IFMT) === S_IFREG,
  isDirectory: () => (args.mode & S_IFMT) === S_IFDIR,
})

const remoteEntry = (args: { name: string; type: string }): FileSystemEntry => ({
  name: args.name,
  isFile: () => args.type === 'f',
  isDirectory: () => args.type === 'd',
})

export class DockerFileSystemPort extends AgentFileSystemPort {
  private readonly processes: ProcessPort

  constructor(args: { processes: ProcessPort }) {
    super()
    this.processes = args.processes
  }

  async stat(args: { path: string; threadId?: ThreadId | undefined }): Promise<FileStat> {
    const outcome = await this.execOrThrow({
      script: 'stat -c \'%s %f %Y\' -- "$1"',
      argv: [args.path],
      threadId: args.threadId,
    })
    const parts = decoder.decode(outcome.stdout).trim().split(' ')
    const [size, rawMode, mtimeSeconds] = parts
    if (size === undefined || rawMode === undefined || mtimeSeconds === undefined) {
      throw new RemoteFileError({ message: `unreadable stat output for ${args.path}` })
    }

    return remoteStat({
      size: Number.parseInt(size, 10),
      mode: Number.parseInt(rawMode, 16),
      mtimeMs: Number.parseInt(mtimeSeconds, 10) * 1000,
    })
  }

  async readLink(args: { path: string; threadId?: ThreadId | undefined }): Promise<string | null> {
    const outcome = await this.exec({
      cmd: ['sh', '-c', 'readlink -- "$1"', 'sh', args.path],
      threadId: args.threadId,
    })
    if (outcome.exitCode !== 0) return null

    const target = decoder.decode(outcome.stdout)
    return target.endsWith('\n') ? target.slice(0, -1) : target
  }

  async readFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<string> {
    return decoder.decode(await this.readBytes(args))
  }

  async readBytes(args: { path: string; threadId?: ThreadId | undefined }): Promise<Uint8Array> {
    const outcome = await this.execOrThrow({
      script: 'base64 -- "$1"',
      argv: [args.path],
      threadId: args.threadId,
    })
    return new Uint8Array(Buffer.from(decoder.decode(outcome.stdout).replace(/\s/g, ''), 'base64'))
  }

  async writeFile(args: {
    path: string
    content: string
    mode?: number | undefined
    threadId?: ThreadId | undefined
  }): Promise<void> {
    const bytes = Buffer.from(args.content, 'utf8')
    const chunks: Buffer[] =
      bytes.length === 0
        ? [Buffer.alloc(0)]
        : Array.from({ length: Math.ceil(bytes.length / WRITE_CHUNK_BYTES) }, (_, index) =>
            bytes.subarray(index * WRITE_CHUNK_BYTES, (index + 1) * WRITE_CHUNK_BYTES),
          )

    for (const [index, chunk] of chunks.entries()) {
      await this.execOrThrow({
        script: `printf %s "$1" | base64 -d ${index === 0 ? '>' : '>>'} "$2"`,
        argv: [chunk.toString('base64'), args.path],
        threadId: args.threadId,
      })
    }

    if (args.mode !== undefined) {
      await this.execOrThrow({
        script: 'chmod "$1" -- "$2"',
        argv: [args.mode.toString(8), args.path],
        threadId: args.threadId,
      })
    }
  }

  async removeFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<void> {
    await this.execOrThrow({ script: 'rm -- "$1"', argv: [args.path], threadId: args.threadId })
  }

  async mkdir(args: { path: string; threadId?: ThreadId | undefined }): Promise<void> {
    await this.execOrThrow({ script: 'mkdir -p -- "$1"', argv: [args.path], threadId: args.threadId })
  }

  async rename(args: {
    from: string
    to: string
    threadId?: ThreadId | undefined
  }): Promise<void> {
    await this.execOrThrow({
      script: 'mv -T -- "$1" "$2"',
      argv: [args.from, args.to],
      threadId: args.threadId,
    })
  }

  async readDirectory(args: {
    path: string
    threadId?: ThreadId | undefined
  }): Promise<readonly FileSystemEntry[]> {
    const outcome = await this.execOrThrow({
      script: 'find "$1" -mindepth 1 -maxdepth 1 -printf \'%y\t%f\0\'',
      argv: [args.path],
      threadId: args.threadId,
    })

    return decoder
      .decode(outcome.stdout)
      .split('\0')
      .filter((record) => record.length > 0)
      .map((record) => remoteEntry({ type: record.charAt(0), name: record.slice(2) }))
  }

  async glob(args: {
    pattern: string
    cwd: string
    dot?: boolean | undefined
    signal?: AbortSignal | undefined
    threadId?: ThreadId | undefined
  }): Promise<readonly string[]> {
    if (args.signal?.aborted) return []

    const base = await this.stat({ path: args.cwd, threadId: args.threadId }).catch(() => null)
    if (base === null || !base.isDirectory()) return []

    const outcome = await this.exec({
      cmd: [
        'rg',
        '--files',
        '--no-ignore',
        '--follow',
        '--no-messages',
        ...(args.dot === true ? ['--hidden'] : []),
        '--glob',
        args.pattern,
      ],
      cwd: args.cwd,
      threadId: args.threadId,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })

    return decoder
      .decode(outcome.stdout)
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => join(args.cwd, line))
  }

  private async execOrThrow(args: {
    script: string
    argv: readonly string[]
    threadId?: ThreadId | undefined
  }): Promise<ExecOutcome> {
    const outcome = await this.exec({
      cmd: ['sh', '-c', args.script, 'sh', ...args.argv],
      threadId: args.threadId,
    })
    if (outcome.exitCode === 0) return outcome

    const complaint = outcome.stderr.trim()
    throw new RemoteFileError({
      message: complaint === '' ? `remote command exited ${outcome.exitCode}` : complaint,
      code: errorCodeIn(outcome.stderr),
    })
  }

  private async exec(args: {
    cmd: readonly string[]
    cwd?: string | undefined
    threadId?: ThreadId | undefined
    signal?: AbortSignal | undefined
  }): Promise<ExecOutcome> {
    const handle = this.processes.spawn({
      cmd: [...args.cmd],
      cwd: args.cwd ?? '/',
      threadId: args.threadId,
    })

    const handleAbort = (): void => handle.terminate()
    args.signal?.addEventListener('abort', handleAbort, { once: true })
    if (args.signal?.aborted === true) handleAbort()

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(handle.stdout).arrayBuffer(),
        new Response(handle.stderr).text(),
        handle.exited,
      ])
      return { stdout: new Uint8Array(stdout), stderr, exitCode }
    } finally {
      args.signal?.removeEventListener('abort', handleAbort)
    }
  }
}
