import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type DeleteObjectsCommandOutput,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type ListObjectsV2CommandOutput,
  type PutObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { ServiceUnavailableException } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import {
  ArtifactBlobStore,
  type ArtifactBlobHead,
  type ArtifactBlobSummary,
  type PresignedUpload,
} from './artifact-blob-store'

const UPLOAD_TTL_MS = 15 * 60 * 1000

const LIST_PAGE_SIZE = 1000

const REMOVE_BATCH_SIZE = 1000

export interface S3Gateway {
  list(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput>
  head(command: HeadObjectCommand): Promise<HeadObjectCommandOutput>
  put(command: PutObjectCommand): Promise<PutObjectCommandOutput>
  read(command: GetObjectCommand): Promise<GetObjectCommandOutput>
  remove(command: DeleteObjectsCommand): Promise<DeleteObjectsCommandOutput>
  signPut(args: { command: PutObjectCommand; ttlMs: number }): Promise<string>
  signGet(args: { command: GetObjectCommand; ttlMs: number }): Promise<string>
}

export interface S3Settings {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  baseUrl: string
}

const secondsOf = (ttlMs: number): number => Math.max(1, Math.floor(ttlMs / 1000))

const trimmedTrailingSlash = (url: string): string => url.replace(/\/+$/, '')

export class AwsS3Gateway implements S3Gateway {
  private readonly client: S3Client

  constructor(args: { client: S3Client }) {
    this.client = args.client
  }

  list(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput> {
    return this.client.send(command)
  }

  head(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
    return this.client.send(command)
  }

  put(command: PutObjectCommand): Promise<PutObjectCommandOutput> {
    return this.client.send(command)
  }

  read(command: GetObjectCommand): Promise<GetObjectCommandOutput> {
    return this.client.send(command)
  }

  remove(command: DeleteObjectsCommand): Promise<DeleteObjectsCommandOutput> {
    return this.client.send(command)
  }

  signPut(args: { command: PutObjectCommand; ttlMs: number }): Promise<string> {
    return getSignedUrl(this.client, args.command, { expiresIn: secondsOf(args.ttlMs) })
  }

  signGet(args: { command: GetObjectCommand; ttlMs: number }): Promise<string> {
    return getSignedUrl(this.client, args.command, { expiresIn: secondsOf(args.ttlMs) })
  }
}

const required = (env: EnvService, key: keyof S3SettingsMap): string => {
  const value = env.get(key)
  if (!value) throw new ServiceUnavailableException(`artifact s3 storage is missing ${key}`)
  return value
}

type S3SettingsMap = {
  ARTIFACT_S3_ENDPOINT: string
  ARTIFACT_S3_REGION: string
  ARTIFACT_S3_BUCKET: string
  ARTIFACT_S3_ACCESS_KEY_ID: string
  ARTIFACT_S3_SECRET_ACCESS_KEY: string
  ARTIFACT_BLOB_BASE_URL: string
}

export const s3SettingsOf = (env: EnvService): S3Settings => ({
  endpoint: required(env, 'ARTIFACT_S3_ENDPOINT'),
  region: required(env, 'ARTIFACT_S3_REGION'),
  bucket: required(env, 'ARTIFACT_S3_BUCKET'),
  accessKeyId: required(env, 'ARTIFACT_S3_ACCESS_KEY_ID'),
  secretAccessKey: required(env, 'ARTIFACT_S3_SECRET_ACCESS_KEY'),
  baseUrl: trimmedTrailingSlash(required(env, 'ARTIFACT_BLOB_BASE_URL')),
})

const clientOf = (settings: S3Settings): S3Client =>
  new S3Client({
    region: settings.region,
    endpoint: settings.endpoint,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    forcePathStyle: true,
  })

const isMissing = (error: unknown): boolean =>
  error instanceof S3ServiceException &&
  (error.$metadata.httpStatusCode === 404 || error.name === 'NoSuchKey')

export class S3ArtifactBlobStore extends ArtifactBlobStore {
  private readonly env: EnvService
  private readonly injected: S3Gateway | null
  private resolved: { gateway: S3Gateway; settings: S3Settings } | null = null

  constructor(args: { env: EnvService; gateway?: S3Gateway }) {
    super()
    this.env = args.env
    this.injected = args.gateway ?? null
  }

  async presignUpload(args: { pathname: string; maxBytes: number }): Promise<PresignedUpload> {
    const { gateway, settings } = this.s3()
    const url = await gateway.signPut({
      command: new PutObjectCommand({ Bucket: settings.bucket, Key: args.pathname }),
      ttlMs: UPLOAD_TTL_MS,
    })
    return { url, validUntil: Date.now() + UPLOAD_TTL_MS }
  }

  async presignDownload(args: { pathname: string; ttlMs: number }): Promise<string> {
    const { gateway, settings } = this.s3()
    return gateway.signGet({
      command: new GetObjectCommand({ Bucket: settings.bucket, Key: args.pathname }),
      ttlMs: args.ttlMs,
    })
  }

  async head(args: { pathname: string }): Promise<ArtifactBlobHead | null> {
    const { gateway, settings } = this.s3()
    try {
      const found = await gateway.head(
        new HeadObjectCommand({ Bucket: settings.bucket, Key: args.pathname }),
      )
      return { url: `${settings.baseUrl}/${args.pathname}`, size: found.ContentLength ?? 0 }
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async put(args: {
    pathname: string
    body: string | Buffer
    contentType: string
    allowOverwrite: boolean
  }): Promise<void> {
    const { gateway, settings } = this.s3()
    await gateway.put(
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: args.pathname,
        Body: args.body,
        ContentType: args.contentType,
        ...(args.allowOverwrite ? {} : { IfNoneMatch: '*' }),
      }),
    )
  }

  async read(args: { pathname: string }): Promise<Buffer | null> {
    const { gateway, settings } = this.s3()
    try {
      const found = await gateway.read(
        new GetObjectCommand({ Bucket: settings.bucket, Key: args.pathname }),
      )
      if (found.Body === undefined) return null
      return Buffer.from(await found.Body.transformToByteArray())
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async delete(args: { pathname: string }): Promise<void> {
    await this.remove([args.pathname])
  }

  async remove(pathnames: readonly string[]): Promise<void> {
    if (pathnames.length === 0) return
    const { gateway, settings } = this.s3()
    for (let start = 0; start < pathnames.length; start += REMOVE_BATCH_SIZE) {
      const batch = pathnames.slice(start, start + REMOVE_BATCH_SIZE)
      const removed = await gateway.remove(
        new DeleteObjectsCommand({
          Bucket: settings.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      )
      const failed = removed.Errors ?? []
      if (failed.length > 0) {
        throw new Error(`artifact s3 delete refused ${failed.length} of ${batch.length} objects`)
      }
    }
  }

  async list(args: { prefix: string }): Promise<ArtifactBlobSummary[]> {
    const { gateway, settings } = this.s3()
    const found: ArtifactBlobSummary[] = []
    let token: string | undefined
    for (;;) {
      const page = await gateway.list(
        new ListObjectsV2Command({
          Bucket: settings.bucket,
          Prefix: args.prefix,
          MaxKeys: LIST_PAGE_SIZE,
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
      )
      for (const object of page.Contents ?? []) {
        if (object.Key === undefined) continue
        found.push({ pathname: object.Key, size: object.Size ?? 0 })
      }
      if (page.IsTruncated !== true || page.NextContinuationToken === undefined) return found
      token = page.NextContinuationToken
    }
  }

  private s3(): { gateway: S3Gateway; settings: S3Settings } {
    if (this.resolved === null) {
      const settings = s3SettingsOf(this.env)
      this.resolved = {
        settings,
        gateway: this.injected ?? new AwsS3Gateway({ client: clientOf(settings) }),
      }
    }
    return this.resolved
  }
}
