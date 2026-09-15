import { describe, expect, it } from 'bun:test'

import {
  AgentFileSystemPort,
  EExecutionLocation,
  toThreadId,
  type FileStat,
  type FileSystemEntry,
  type ThreadId,
} from '@dltech/atlas-core'

import { RoutedFileSystemPort } from '../routed-filesystem'

const HOST_THREAD = toThreadId('host-thread')
const DOCKER_THREAD = toThreadId('docker-thread')

const STAT: FileStat = {
  size: 1,
  mode: 0o100644,
  mtimeMs: 1000,
  isFile: () => true,
  isDirectory: () => false,
}

const ENTRY: FileSystemEntry = { name: 'a', isFile: () => true, isDirectory: () => false }

type Call = { method: string; threadId: ThreadId | undefined }

class RecordingFiles extends AgentFileSystemPort {
  readonly calls: Call[] = []

  private note(method: string, args: { threadId?: ThreadId | undefined }): void {
    this.calls.push({ method, threadId: args.threadId })
  }

  stat(args: { path: string; threadId?: ThreadId | undefined }): Promise<FileStat> {
    this.note('stat', args)
    return Promise.resolve(STAT)
  }

  readLink(args: { path: string; threadId?: ThreadId | undefined }): Promise<string | null> {
    this.note('readLink', args)
    return Promise.resolve(null)
  }

  readFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<string> {
    this.note('readFile', args)
    return Promise.resolve('')
  }

  readBytes(args: { path: string; threadId?: ThreadId | undefined }): Promise<Uint8Array> {
    this.note('readBytes', args)
    return Promise.resolve(new Uint8Array())
  }

  writeFile(args: {
    path: string
    content: string
    threadId?: ThreadId | undefined
  }): Promise<void> {
    this.note('writeFile', args)
    return Promise.resolve()
  }

  removeFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<void> {
    this.note('removeFile', args)
    return Promise.resolve()
  }

  mkdir(args: { path: string; threadId?: ThreadId | undefined }): Promise<void> {
    this.note('mkdir', args)
    return Promise.resolve()
  }

  rename(args: { from: string; to: string; threadId?: ThreadId | undefined }): Promise<void> {
    this.note('rename', args)
    return Promise.resolve()
  }

  readDirectory(args: {
    path: string
    threadId?: ThreadId | undefined
  }): Promise<readonly FileSystemEntry[]> {
    this.note('readDirectory', args)
    return Promise.resolve([ENTRY])
  }

  glob(args: {
    pattern: string
    cwd: string
    threadId?: ThreadId | undefined
  }): Promise<readonly string[]> {
    this.note('glob', args)
    return Promise.resolve([])
  }
}

const locationOf = (threadId: ThreadId | undefined): EExecutionLocation | undefined =>
  threadId === DOCKER_THREAD ? EExecutionLocation.Docker : undefined

describe('RoutedFileSystemPort', () => {
  it('sends a host-located thread to the local port', async () => {
    const local = new RecordingFiles()
    let dockerBuilt = 0
    const port = new RoutedFileSystemPort({
      local,
      dockerFor: () => {
        dockerBuilt += 1
        return new RecordingFiles()
      },
      locationOf,
    })

    await port.stat({ path: '/x', threadId: HOST_THREAD })

    expect(local.calls).toHaveLength(1)
    expect(dockerBuilt).toBe(0)
  })

  it('sends a docker-located thread to the docker port with the thread on the call', async () => {
    const local = new RecordingFiles()
    const docker = new RecordingFiles()
    const port = new RoutedFileSystemPort({ local, dockerFor: () => docker, locationOf })

    await port.readFile({ path: '/x', threadId: DOCKER_THREAD })
    await port.writeFile({ path: '/x', content: 'c', threadId: DOCKER_THREAD })

    expect(local.calls).toHaveLength(0)
    expect(docker.calls.map((call) => call.method)).toEqual(['readFile', 'writeFile'])
    expect(docker.calls.every((call) => call.threadId === DOCKER_THREAD)).toBe(true)
  })

  it('builds the docker port lazily and only once', async () => {
    let dockerBuilt = 0
    const port = new RoutedFileSystemPort({
      local: new RecordingFiles(),
      dockerFor: () => {
        dockerBuilt += 1
        return new RecordingFiles()
      },
      locationOf,
    })

    await port.stat({ path: '/x', threadId: DOCKER_THREAD })
    await port.glob({ pattern: '*', cwd: '/x', threadId: DOCKER_THREAD })

    expect(dockerBuilt).toBe(1)
  })

  it('keeps a call that names no thread on the local port', async () => {
    const local = new RecordingFiles()
    const docker = new RecordingFiles()
    const port = new RoutedFileSystemPort({ local, dockerFor: () => docker, locationOf })

    await port.readDirectory({ path: '/x' })

    expect(local.calls).toHaveLength(1)
    expect(docker.calls).toHaveLength(0)
  })
})
