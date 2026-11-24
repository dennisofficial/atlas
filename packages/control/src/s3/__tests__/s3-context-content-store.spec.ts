import { describe, expect, it } from 'bun:test'

import type { GetObjectCommandOutput } from '@aws-sdk/client-s3'

import { ContextContentStore } from '../../context-content'
import { CONTEXT_S3_PREFIX, contextSettingsOf, S3ContextContentStore } from '..'

const baseEnv = (overrides: Record<string, string> = {}): Record<string, string | undefined> => ({
  ARTIFACT_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  ARTIFACT_S3_REGION: 'auto',
  ARTIFACT_S3_BUCKET: 'atlas-artifacts',
  ARTIFACT_S3_ACCESS_KEY_ID: 'key',
  ARTIFACT_S3_SECRET_ACCESS_KEY: 'secret',
  ...overrides,
})

describe('contextSettingsOf', () => {
  it('keeps the artifact credentials and moves the prefix to the context files', () => {
    expect(contextSettingsOf(baseEnv())).toMatchObject({
      settings: { bucket: 'atlas-artifacts', accessKeyId: 'key' },
      prefix: 'context-files',
    })
    expect(CONTEXT_S3_PREFIX).toBe('context-files')
  })

  it('honours a context prefix of its own', () => {
    expect(contextSettingsOf(baseEnv({ CONTEXT_S3_PREFIX: 'ctx' })).prefix).toBe('ctx')
  })

  it('names the missing credential when the tier has none', () => {
    expect(() => contextSettingsOf(baseEnv({ ARTIFACT_S3_SECRET_ACCESS_KEY: '' }))).toThrow(
      'ARTIFACT_S3_SECRET_ACCESS_KEY',
    )
  })
})

describe('S3ContextContentStore', () => {
  it('is a context content store that reads and writes the context prefix', async () => {
    const objects = new Map<string, Uint8Array>()
    const store = new S3ContextContentStore({
      settings: () => contextSettingsOf(baseEnv()),
      gateway: {
        put: async (command) => {
          objects.set(command.input.Key ?? '', command.input.Body as Uint8Array)
          return { $metadata: {} }
        },
        read: async (command) => {
          const bytes = objects.get(command.input.Key ?? '')
          if (bytes === undefined) throw new Error('missing')
          const body = { transformToByteArray: async () => bytes }
          return { $metadata: {}, Body: body } as unknown as GetObjectCommandOutput
        },
        remove: async () => ({ $metadata: {} }),
        list: async () => ({ $metadata: {}, Contents: [] }),
        signGet: async (args) => `https://signed/${args.command.input.Key}`,
        signPut: async (args) => `https://signed-put/${args.command.input.Key}`,
        head: async (command) => objects.has(command.input.Key ?? ''),
      },
    })

    expect(store).toBeInstanceOf(ContextContentStore)
    await store.put({ hash: 'ab'.padEnd(64, '0'), bytes: new Uint8Array([1, 2]) })
    expect([...objects.keys()]).toEqual([`context-files/sha256/ab/${'ab'.padEnd(64, '0')}`])
    expect(await store.read({ hash: 'ab'.padEnd(64, '0') })).toEqual(new Uint8Array([1, 2]))
    expect(await store.presignGet({ hash: 'ab'.padEnd(64, '0'), ttlMs: 1_000 })).toContain(
      'context-files/sha256/ab/',
    )
    expect(await store.list()).toEqual([])
  })
})
