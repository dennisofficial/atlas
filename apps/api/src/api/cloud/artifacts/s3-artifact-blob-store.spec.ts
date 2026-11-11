import {
  DeleteObjectsCommand,
  GetObjectCommand,
  type DeleteObjectsCommandOutput,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type ListObjectsV2CommandOutput,
  type PutObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type HeadObjectCommand,
  type ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { describe, expect, it } from 'bun:test'
import type { EnvService } from '../../../_core/config/env/env.service'
import { artifactBlobStoreOf } from './artifact-blob-store.provider'
import {
  AwsS3Gateway,
  S3ArtifactBlobStore,
  type S3Gateway,
  type S3Settings,
} from './s3-artifact-blob-store'
import { VercelArtifactBlobStore } from './vercel-artifact-blob-store'

const ROUTE_KEY = 'artifacts/at-1/_route/index.html'

const SETTINGS: Record<keyof S3Settings, string> = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'atlas-artifacts',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  baseUrl: 'https://objects.test',
}

const envOf = (values: Record<string, string>): EnvService =>
  ({ get: (key: string) => values[key] }) as unknown as EnvService

const s3EnvOf = (overrides: Record<string, string> = {}): EnvService =>
  envOf({
    ARTIFACT_STORAGE: 's3',
    ARTIFACT_S3_ENDPOINT: SETTINGS.endpoint,
    ARTIFACT_S3_REGION: SETTINGS.region,
    ARTIFACT_S3_BUCKET: SETTINGS.bucket,
    ARTIFACT_S3_ACCESS_KEY_ID: SETTINGS.accessKeyId,
    ARTIFACT_S3_SECRET_ACCESS_KEY: SETTINGS.secretAccessKey,
    ARTIFACT_BLOB_BASE_URL: SETTINGS.baseUrl,
    ...overrides,
  })

const missing = (): S3ServiceException =>
  new S3ServiceException({
    name: 'NotFound',
    $fault: 'client',
    message: 'not found',
    $metadata: { httpStatusCode: 404 },
  })

const bodyOf = (bytes: Buffer): NonNullable<GetObjectCommandOutput['Body']> =>
  ({
    transformToByteArray: async () => new Uint8Array(bytes),
  }) as unknown as NonNullable<GetObjectCommandOutput['Body']>

class FakeS3Gateway implements S3Gateway {
  readonly puts: PutObjectCommand[] = []
  readonly heads: HeadObjectCommand[] = []
  readonly reads: GetObjectCommand[] = []
  readonly removes: DeleteObjectsCommand[] = []
  readonly lists: ListObjectsV2Command[] = []
  readonly signedPuts: PutObjectCommand[] = []
  readonly signedGets: GetObjectCommand[] = []
  headSize: number | null = 4096
  objects = new Map<string, Buffer>()
  pages: ListObjectsV2CommandOutput[] = []

  async list(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput> {
    this.lists.push(command)
    const token = command.input.ContinuationToken
    return this.pages[token === undefined ? 0 : Number(token)] ?? { $metadata: {} }
  }

  async head(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
    this.heads.push(command)
    if (this.headSize === null) throw missing()
    return { $metadata: {}, ContentLength: this.headSize }
  }

  async put(command: PutObjectCommand): Promise<PutObjectCommandOutput> {
    this.puts.push(command)
    return { $metadata: {} }
  }

  async read(command: GetObjectCommand): Promise<GetObjectCommandOutput> {
    this.reads.push(command)
    const stored = command.input.Key === undefined ? undefined : this.objects.get(command.input.Key)
    if (stored === undefined) throw missing()
    return { $metadata: {}, Body: bodyOf(stored) }
  }

  async remove(command: DeleteObjectsCommand): Promise<DeleteObjectsCommandOutput> {
    this.removes.push(command)
    return { $metadata: {} }
  }

  async signPut(args: { command: PutObjectCommand; ttlMs: number }): Promise<string> {
    this.signedPuts.push(args.command)
    return `https://objects.test/${args.command.input.Key}?expires=${args.ttlMs}`
  }

  async signGet(args: { command: GetObjectCommand; ttlMs: number }): Promise<string> {
    this.signedGets.push(args.command)
    return `https://objects.test/${args.command.input.Key}?expires=${args.ttlMs}`
  }
}

const storeWith = (gateway: FakeS3Gateway): S3ArtifactBlobStore =>
  new S3ArtifactBlobStore({ env: s3EnvOf(), gateway })

describe('S3ArtifactBlobStore', () => {
  it('presigns an upload of the artifact key for fifteen minutes', async () => {
    const gateway = new FakeS3Gateway()
    const started = Date.now()
    const upload = await storeWith(gateway).presignUpload({ pathname: ROUTE_KEY, maxBytes: 1024 })

    expect(gateway.signedPuts.map((command) => command.input.Key)).toEqual([ROUTE_KEY])
    expect(upload.url).toBe(`https://objects.test/${ROUTE_KEY}?expires=900000`)
    expect(upload.validUntil).toBeGreaterThanOrEqual(started + 900_000)
  })

  it('presigns a download for the requested ttl', async () => {
    const gateway = new FakeS3Gateway()
    const url = await storeWith(gateway).presignDownload({ pathname: ROUTE_KEY, ttlMs: 60_000 })

    expect(gateway.signedGets.map((command) => command.input.Key)).toEqual([ROUTE_KEY])
    expect(url).toBe(`https://objects.test/${ROUTE_KEY}?expires=60000`)
  })

  it('reports the public url and byte size of a stored object', async () => {
    const gateway = new FakeS3Gateway()
    const head = await storeWith(gateway).head({ pathname: ROUTE_KEY })

    expect(gateway.heads[0]?.input).toMatchObject({ Bucket: SETTINGS.bucket, Key: ROUTE_KEY })
    expect(head).toEqual({ url: `https://objects.test/${ROUTE_KEY}`, size: 4096 })
  })

  it('answers null for an object the bucket does not hold', async () => {
    const gateway = new FakeS3Gateway()
    gateway.headSize = null

    expect(await storeWith(gateway).head({ pathname: ROUTE_KEY })).toBeNull()
  })

  it('puts at the artifact key and refuses to overwrite when the caller says so', async () => {
    const gateway = new FakeS3Gateway()
    const store = storeWith(gateway)

    await store.put({
      pathname: ROUTE_KEY,
      body: '<html></html>',
      contentType: 'text/html',
      allowOverwrite: false,
    })
    await store.put({
      pathname: ROUTE_KEY,
      body: '<html></html>',
      contentType: 'text/html',
      allowOverwrite: true,
    })

    expect(gateway.puts.map((command) => command.input.IfNoneMatch)).toEqual(['*', undefined])
    expect(gateway.puts[0]?.input).toMatchObject({
      Bucket: SETTINGS.bucket,
      Key: ROUTE_KEY,
      ContentType: 'text/html',
    })
  })

  it('reads the object bytes and answers null when the key is gone', async () => {
    const gateway = new FakeS3Gateway()
    gateway.objects.set(ROUTE_KEY, Buffer.from('<html></html>'))
    const store = storeWith(gateway)

    expect((await store.read({ pathname: ROUTE_KEY }))?.toString()).toBe('<html></html>')
    expect(await store.read({ pathname: 'artifacts/at-1/_route/missing.html' })).toBeNull()
  })

  it('deletes one object per delete call', async () => {
    const gateway = new FakeS3Gateway()

    await storeWith(gateway).delete({ pathname: ROUTE_KEY })

    expect(gateway.removes).toHaveLength(1)
    expect(gateway.removes[0]?.input.Delete?.Objects?.map((object) => object.Key)).toEqual([
      ROUTE_KEY,
    ])
  })

  it('batches a bulk remove into requests of a thousand keys', async () => {
    const gateway = new FakeS3Gateway()
    const pathnames = Array.from(
      { length: 2500 },
      (_, index) => `artifacts/at-1/_route/${index}.html`,
    )

    await storeWith(gateway).remove(pathnames)

    expect(gateway.removes.map((command) => command.input.Delete?.Objects?.length ?? 0)).toEqual([
      1000, 1000, 500,
    ])
    expect(gateway.removes.flatMap((command) => command.input.Delete?.Objects ?? [])).toHaveLength(
      2500,
    )
  })

  it('pages through every listed object under the prefix', async () => {
    const gateway = new FakeS3Gateway()
    gateway.pages = [
      {
        $metadata: {},
        IsTruncated: true,
        NextContinuationToken: '1',
        Contents: [{ Key: 'routes/a.json', Size: 12 }],
      },
      { $metadata: {}, IsTruncated: false, Contents: [{ Key: 'routes/b.json', Size: 34 }] },
    ]

    const listed = await storeWith(gateway).list({ prefix: 'routes/' })

    expect(listed).toEqual([
      { pathname: 'routes/a.json', size: 12 },
      { pathname: 'routes/b.json', size: 34 },
    ])
    expect(gateway.lists.map((command) => command.input)).toEqual([
      { Bucket: SETTINGS.bucket, Prefix: 'routes/', MaxKeys: 1000 },
      { Bucket: SETTINGS.bucket, Prefix: 'routes/', MaxKeys: 1000, ContinuationToken: '1' },
    ])
  })

  it('fails when the s3 keys are missing', async () => {
    const store = new S3ArtifactBlobStore({
      env: envOf({ ARTIFACT_STORAGE: 's3' }),
      gateway: new FakeS3Gateway(),
    })

    expect(store.list({ prefix: 'routes/' })).rejects.toThrow('artifact s3 storage is missing')
  })
})

describe('AwsS3Gateway', () => {
  const gateway = new AwsS3Gateway({
    client: new S3Client({
      region: SETTINGS.region,
      endpoint: SETTINGS.endpoint,
      credentials: { accessKeyId: SETTINGS.accessKeyId, secretAccessKey: SETTINGS.secretAccessKey },
      forcePathStyle: true,
    }),
  })

  it('signs a path-style download url against the configured endpoint', async () => {
    const url = new URL(
      await gateway.signGet({
        command: new GetObjectCommand({ Bucket: SETTINGS.bucket, Key: ROUTE_KEY }),
        ttlMs: 900_000,
      }),
    )

    expect(url.host).toBe('account.r2.cloudflarestorage.com')
    expect(url.pathname).toBe(`/${SETTINGS.bucket}/${ROUTE_KEY}`)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('signs an upload url against the configured endpoint', async () => {
    const url = new URL(
      await gateway.signPut({
        command: new PutObjectCommand({ Bucket: SETTINGS.bucket, Key: ROUTE_KEY }),
        ttlMs: 900_000,
      }),
    )

    expect(url.pathname).toBe(`/${SETTINGS.bucket}/${ROUTE_KEY}`)
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('artifactBlobStoreOf', () => {
  it('binds the s3 adapter when the tier selects it', () => {
    expect(artifactBlobStoreOf(s3EnvOf())).toBeInstanceOf(S3ArtifactBlobStore)
  })

  it('binds the vercel adapter otherwise', () => {
    expect(artifactBlobStoreOf(envOf({ ARTIFACT_STORAGE: 'vercel' }))).toBeInstanceOf(
      VercelArtifactBlobStore,
    )
  })
})
