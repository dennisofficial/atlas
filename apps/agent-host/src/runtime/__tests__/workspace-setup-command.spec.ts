import { describe, expect, it } from 'bun:test'

import {
  FileSystemPort,
  ProcessPort,
  type FileStat,
  type FileSystemEntry,
  type ProcessHandle,
  type SpawnCommand,
} from '@dltech/atlas-core'

import { ensureWorkspace } from '../workspace-setup'

class RecordingProcessPort extends ProcessPort {
  readonly spawned: SpawnCommand[] = []

  override spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    return {
      stdout: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited: Promise.resolve(0),
      terminate: () => {},
    }
  }

  override which(): string | null {
    return null
  }
}

class StubFileSystemPort extends FileSystemPort {
  override stat(): Promise<FileStat> {
    return Promise.reject(new Error('missing'))
  }

  override readLink(): Promise<string | null> {
    return Promise.resolve(null)
  }

  override readFile(): Promise<string> {
    return Promise.reject(new Error('missing'))
  }

  override readBytes(): Promise<Uint8Array> {
    return Promise.reject(new Error('missing'))
  }

  override readTextForEdit(): Promise<{ text: string; strict: string | null }> {
    return Promise.reject(new Error('missing'))
  }

  override writeFile(): Promise<void> {
    return Promise.resolve()
  }

  override removeFile(): Promise<void> {
    return Promise.resolve()
  }

  override mkdir(): Promise<void> {
    return Promise.resolve()
  }

  override rename(): Promise<void> {
    return Promise.resolve()
  }

  override readDirectory(): Promise<readonly FileSystemEntry[]> {
    return Promise.resolve([])
  }

  override glob(): Promise<readonly string[]> {
    return Promise.resolve([])
  }
}

describe('workspace setup command', () => {
  it('runs the setup script through sh -c with the inherited env, as v1 does', async () => {
    const processes = new RecordingProcessPort()

    await ensureWorkspace({
      calls: { ackScope: () => Promise.resolve() },
      processes,
      files: new StubFileSystemPort(),
      workspace: {
        remoteUrl: null,
        baseBranch: null,
        additionalRepos: [],
        setupScript: 'bun install',
      },
      githubToken: null,
      launchDirectory: '/workspace/repo',
      sandboxName: 'sandbox-a',
    })

    const setup = processes.spawned.find((call) => call.cmd.includes('bun install'))
    expect(setup?.cmd).toEqual(['sh', '-c', 'bun install'])
    expect(setup?.env).toBeUndefined()
  })
})
