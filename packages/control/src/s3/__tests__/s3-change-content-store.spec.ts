import {
  type DeleteObjectsCommand,
  type DeleteObjectsCommandOutput,
  type GetObjectCommand,
  type GetObjectCommandOutput,
  type HeadObjectCommand,
  type ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  type PutObjectCommand,
  type PutObjectCommandOutput,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { describe, expect, it } from 'bun:test'

import {
  ChangeStorageMissingError,
  changesSettingsOf,
  type ChangesS3Gateway,
  S3ChangeContentStore,
} from '..'

const HASH = 'ab'.padEnd(64, '0')
const OTHER = 'cd'.padEnd(64, '1')

const baseEnv = (overrides: Record<string, string> = {}): Record<string, string | undefined> => ({
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
  readonly signedPuts: { command: PutObjectCommand; ttlMs: number }[] = []
  readonly heads: HeadObjectCommand[] = []
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

  async signPut(args: { command: PutObjectCommand; ttlMs: number }): Promise<string> {
    this.signedPuts.push(args)
    return `https://signed-put/${args.command.input.Key}`
  }

  async head(command: HeadObjectCommand): Promise<boolean> {
    this.heads.push(command)
    return this.objects.has(command.input.Key ?? '')
  }
}

const storeOf = (env: Record<string, string | undefined> = baseEnv()) => {
  const gateway = new FakeGateway()
  return {
    gateway,
    store: new S3ChangeContentStore({ settings: () => changesSettingsOf(env), gateway }),
  }
}

describe('changesSettingsOf', () => {
  it('reads the artifact credentials and falls back to the artifact bucket', () => {
    expect(changesSettingsOf(baseEnv())).toEqual({
      settings: {
        endpoint: 'https://account.r2.cloudflarestorage.com',
        region: 'auto',
        bucket: 'atlas-artifacts',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
      prefix: 'worktree-changes',
    })
  })

  it('prefers the changes bucket and prefix when they are set', () => {
    const settings = changesSettingsOf(
      baseEnv({ CHANGES_S3_BUCKET: 'atlas-changes', CHANGES_S3_PREFIX: 'wc' }),
    )
    expect(settings.settings.bucket).toBe('atlas-changes')
    expect(settings.prefix).toBe('wc')
  })

  it('names the missing key when a credential is absent', () => {
    const env = baseEnv({ ARTIFACT_S3_SECRET_ACCESS_KEY: '' })
    expect(() => changesSettingsOf(env)).toThrow(
      new ChangeStorageMissingError('change storage is missing ARTIFACT_S3_SECRET_ACCESS_KEY'),
    )
  })

  it('names CHANGES_S3_BUCKET when no bucket is configured', () => {
    expect(() => changesSettingsOf(baseEnv({ ARTIFACT_S3_BUCKET: '' }))).toThrow(
      new ChangeStorageMissingError('change storage is missing CHANGES_S3_BUCKET'),
    )
  })
})

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

  it('carries the response type and the download name on the signed command', async () => {
    const { gateway, store } = storeOf()
    await store.presignGet({
      hash: HASH,
      ttlMs: 300_000,
      contentType: 'video/mp4',
      downloadName: 'walkthrough.mp4',
    })
    expect(gateway.signed[0]?.command.input.ResponseContentType).toBe('video/mp4')
    expect(gateway.signed[0]?.command.input.ResponseContentDisposition).toBe(
      `attachment; filename="walkthrough.mp4"; filename*=UTF-8''walkthrough.mp4`,
    )
  })

  it('presigns a PUT for the content key as a byte stream', async () => {
    const { gateway, store } = storeOf()
    const url = await store.presignPut({ hash: HASH, ttlMs: 900_000 })
    expect(url).toBe(`https://signed-put/worktree-changes/sha256/ab/${HASH}`)
    expect(gateway.signedPuts[0]?.ttlMs).toBe(900_000)
    expect(gateway.signedPuts[0]?.command.input.ContentType).toBe('application/octet-stream')
  })

  it('answers whether the content key is in the bucket', async () => {
    const { gateway, store } = storeOf()
    gateway.objects.set(`worktree-changes/sha256/ab/${HASH}`, new Uint8Array([1]))
    expect(await store.exists({ hash: HASH })).toBeTrue()
    expect(await store.exists({ hash: OTHER })).toBeFalse()
    expect(gateway.heads).toHaveLength(2)
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

  it('resolves its settings once, on the first call', async () => {
    let reads = 0
    const gateway = new FakeGateway()
    const store = new S3ChangeContentStore({
      settings: () => {
        reads += 1
        return changesSettingsOf(baseEnv())
      },
      gateway,
    })

    await store.put({ hash: HASH, bytes: new Uint8Array([1]) })
    await store.put({ hash: OTHER, bytes: new Uint8Array([1]) })

    expect(reads).toBe(1)
  })

  it('reports missing change storage when no bucket is configured', async () => {
    const { store } = storeOf(baseEnv({ ARTIFACT_S3_BUCKET: '' }))
    await expect(store.put({ hash: HASH, bytes: new Uint8Array() })).rejects.toThrow(
      ChangeStorageMissingError,
    )
    await expect(store.put({ hash: HASH, bytes: new Uint8Array() })).rejects.toThrow(
      'CHANGES_S3_BUCKET',
    )
  })
})
