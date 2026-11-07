import { describe, expect, it } from 'bun:test'

import { FileSystemPort } from '@dltech/atlas-core'
import { ELogSeverity } from '@dltech/atlas-observability'

import { CollectingLog } from '../../__tests__/e2e-support'
import { prepareSigning } from '../signing-setup'

const KEY = {
  publicKey: 'ssh-ed25519 AAAApublic',
  privateKey: '-----PRIVATE-SECRET-----',
  userName: 'Dennis',
  userEmail: 'dennis@example.com',
}

type Written = { path: string; content: string; mode: number | undefined }

const recordingFiles = (args: { failWrites?: boolean } = {}) => {
  const written: Written[] = []
  const dirs: string[] = []
  const files = {
    mkdir: async ({ path }: { path: string }) => {
      dirs.push(path)
    },
    writeFile: async (call: { path: string; content: string; mode?: number }) => {
      if (args.failWrites === true) throw new Error('disk full')
      written.push({ path: call.path, content: call.content, mode: call.mode })
    },
  } as unknown as FileSystemPort
  return { files, written, dirs }
}

const signal = new AbortController().signal

describe('prepareSigning', () => {
  it('writes the key at 0600 and the allowed signers at 0644 beside the workspace', async () => {
    const { files, written, dirs } = recordingFiles()
    const signing = await prepareSigning({
      reader: { read: async () => KEY },
      files,
      userId: 'u',
      launchDirectory: '/atlas/workspaces/workspace',
      signal,
    })
    expect(signing).toEqual({
      keyPath: '/atlas/workspaces/.atlas-agent/signing-key',
      allowedSignersPath: '/atlas/workspaces/.atlas-agent/allowed-signers',
      userName: 'Dennis',
      userEmail: 'dennis@example.com',
    })
    expect(dirs).toEqual(['/atlas/workspaces/.atlas-agent'])
    expect(written).toEqual([
      {
        path: '/atlas/workspaces/.atlas-agent/signing-key',
        content: '-----PRIVATE-SECRET-----\n',
        mode: 0o600,
      },
      {
        path: '/atlas/workspaces/.atlas-agent/allowed-signers',
        content: 'dennis@example.com ssh-ed25519 AAAApublic\n',
        mode: 0o644,
      },
    ])
  })

  it('does not double the trailing newline and rewrites identically on a second call', async () => {
    const { files, written } = recordingFiles()
    const args = {
      reader: { read: async () => ({ ...KEY, privateKey: 'KEY\n' }) },
      files,
      userId: 'u',
      launchDirectory: '/w/workspace',
      signal,
    }
    await prepareSigning(args)
    await prepareSigning(args)
    expect(written.map((entry) => entry.content)).toEqual([
      'KEY\n',
      'dennis@example.com ssh-ed25519 AAAApublic\n',
      'KEY\n',
      'dennis@example.com ssh-ed25519 AAAApublic\n',
    ])
  })

  it('writes nothing and answers null without a key or reader', async () => {
    const { files, written } = recordingFiles()
    const base = { files, userId: 'u', launchDirectory: '/w/workspace', signal }
    expect(await prepareSigning({ ...base, reader: { read: async () => null } })).toBeNull()
    expect(await prepareSigning({ ...base, reader: undefined })).toBeNull()
    expect(written).toEqual([])
  })

  it('warns once without the key contents when the read fails', async () => {
    const log = new CollectingLog()
    const { files, written } = recordingFiles()
    const signing = await prepareSigning({
      reader: {
        read: async () => {
          throw new Error('decrypt failed')
        },
      },
      files,
      userId: 'u',
      launchDirectory: '/w/workspace',
      signal,
      log,
    })
    expect(signing).toBeNull()
    expect(written).toEqual([])
    expect(log.entries.map((entry) => entry.severity)).toEqual([ELogSeverity.Warn])
    expect(log.dump('x')).toContain('decrypt failed')
  })

  it('warns once without the key contents when a write fails', async () => {
    const log = new CollectingLog()
    const { files } = recordingFiles({ failWrites: true })
    const signing = await prepareSigning({
      reader: { read: async () => KEY },
      files,
      userId: 'u',
      launchDirectory: '/w/workspace',
      signal,
      log,
    })
    expect(signing).toBeNull()
    expect(log.entries.map((entry) => entry.severity)).toEqual([ELogSeverity.Warn])
    const dump = JSON.stringify(log.entries)
    expect(dump).not.toContain('PRIVATE-SECRET')
    expect(dump).not.toContain('AAAApublic')
  })

  it('propagates an abort instead of starting unsigned', async () => {
    const controller = new AbortController()
    controller.abort(new Error('deadline'))
    const { files } = recordingFiles()
    await expect(
      prepareSigning({
        reader: { read: async () => KEY },
        files,
        userId: 'u',
        launchDirectory: '/w/workspace',
        signal: controller.signal,
      }),
    ).rejects.toThrow('deadline')
  })
})
