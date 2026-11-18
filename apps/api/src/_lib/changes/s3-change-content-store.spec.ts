import {
  type DeleteObjectsCommand,
  type DeleteObjectsCommandOutput,
  type GetObjectCommand,
  type GetObjectCommandOutput,
  type ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  type PutObjectCommand,
  type PutObjectCommandOutput,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { describe, expect, it } from 'bun:test'
import type { EnvService } from '../../_core/config/env/env.service'
import { type ChangesS3Gateway, S3ChangeContentStore } from './s3-change-content-store'

const HASH = 'ab'.padEnd(64, '0')
const OTHER = 'cd'.padEnd(64, '1')

const envOf = (values: Record<string, string>): EnvService =>
  ({ get: (key: string) => values[key] }) as unknown as EnvService

const baseEnv = (overrides: Record<string, string> = {}): EnvService =>
  envOf({
    ARTIFACT_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    ARTIFACT_S3_REGION: 'auto',
    ARTIFACT_S3_BUCKET: 'atlas-artifacts',
    ARTIFACT_S3_ACCESS_KEY_ID: 'key',
    ARTIFACT_S3_SECRET_ACCESS_KEY: 'secret',
    ...overrides,
  })

const notFound = (): S3ServiceException =>
  new S3ServiceException({
    name: 'NoSuchKey',
    $fault: 'client',
    message: 'missing',
    $metadata: { httpStatusCode: 404 },
  })

class FakeGateway implements ChangesS3Gateway {
  readonly puts: PutObjectCommand[] = []
  readonly removes: DeleteObjectsCommand[] = []
  readonly signed: { command: GetObjectCommand; ttlMs: number }[] = []
  readonly objects = new Map<string, Uint8Array>()
  pages: ListObjectsV2CommandOutput[] = []

  async put(command: PutObjectCommand): Promise<PutObjectCommandOutput> {
    this.puts.push(command)
    return { $metadata: {} }
  }

  async read(command: GetObjectCommand): Promise<GetObjectCommandOutput> {
    const bytes = this.objects.get(command.input.Key ?? '')
    if (bytes === undefined) throw notFound()
    const body = { transformToByteArray: async () => bytes }
    return { $metadata: {}, Body: body } as unknown as GetObjectCommandOutput
  }

  async remove(command: DeleteObjectsCommand): Promise<DeleteObjectsCommandOutput> {
    this.removes.push(command)
    return { $metadata: {} }
  }

  async list(_command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput> {
    return this.pages.shift() ?? { $metadata: {} }
  }

  async signGet(args: { command: GetObjectCommand; ttlMs: number }): Promise<string> {
    this.signed.push(args)
    return `https://signed/${args.command.input.Key}`
  }
}

const storeOf = (env: EnvService = baseEnv()) => {
  const gateway = new FakeGateway()
  return { gateway, store: new S3ChangeContentStore({ env, gateway }) }
}

describe('S3ChangeContentStore', () => {
  it('puts content under the sharded sha256 key in the changes bucket', async () => {
    const { gateway, store } = storeOf(baseEnv({ CHANGES_S3_BUCKET: 'atlas-changes' }))
    await store.put({ hash: HASH, bytes: new Uint8Array([1]) })
    expect(gateway.puts[0]?.input.Bucket).toBe('atlas-changes')
    expect(gateway.puts[0]?.input.Key).toBe(`worktree-changes/sha256/ab/${HASH}`)
  })

  it('falls back to the artifact bucket and honours a custom prefix', async () => {
    const { gateway, store } = storeOf(baseEnv({ CHANGES_S3_PREFIX: 'wc' }))
    await store.put({ hash: HASH, bytes: new Uint8Array([1]) })
    expect(gateway.puts[0]?.input.Bucket).toBe('atlas-artifacts')
    expect(gateway.puts[0]?.input.Key).toBe(`wc/sha256/ab/${HASH}`)
  })

  it('reads stored bytes and returns null for a missing object', async () => {
    const { gateway, store } = storeOf()
    gateway.objects.set(`worktree-changes/sha256/ab/${HASH}`, new Uint8Array([7, 8]))
    expect(await store.read({ hash: HASH })).toEqual(new Uint8Array([7, 8]))
    expect(await store.read({ hash: OTHER })).toBeNull()
  })

  it('presigns a GET for the content key with the requested ttl', async () => {
    const { gateway, store } = storeOf()
    const url = await store.presignGet({ hash: HASH, ttlMs: 300_000 })
    expect(url).toBe(`https://signed/worktree-changes/sha256/ab/${HASH}`)
    expect(gateway.signed[0]?.ttlMs).toBe(300_000)
  })

  it('removes in batches of 1000 and skips an empty list', async () => {
    const { gateway, store } = storeOf()
    await store.removing([])
    expect(gateway.removes).toHaveLength(0)
    await store.removing(Array.from({ length: 1001 }, () => HASH))
    expect(gateway.removes.map((command) => command.input.Delete?.Objects?.length)).toEqual([
      1000, 1,
    ])
  })

  it('lists content across pages and ignores keys that are not content', async () => {
    const { gateway, store } = storeOf()
    const at = new Date(1_000)
    gateway.pages = [
      {
        $metadata: {},
        IsTruncated: true,
        NextContinuationToken: 'next',
        Contents: [
          { Key: `worktree-changes/sha256/ab/${HASH}`, Size: 3, LastModified: at },
          { Key: 'worktree-changes/stray.txt', Size: 1 },
        ],
      },
      { $metadata: {}, Contents: [{ Key: `worktree-changes/sha256/cd/${OTHER}`, Size: 5 }] },
    ]
    expect(await store.list()).toEqual([
      { hash: HASH, size: 3, createdAt: 1_000 },
      { hash: OTHER, size: 5, createdAt: 0 },
    ])
  })

  it('reports unavailable when no bucket is configured', async () => {
    const { store } = storeOf(baseEnv({ ARTIFACT_S3_BUCKET: '' }))
    await expect(store.put({ hash: HASH, bytes: new Uint8Array() })).rejects.toThrow(
      'CHANGES_S3_BUCKET',
    )
  })
})
