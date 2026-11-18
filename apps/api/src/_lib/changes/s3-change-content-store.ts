import {
  type DeleteObjectsCommand,
  DeleteObjectsCommand as DeleteCommand,
  type DeleteObjectsCommandOutput,
  GetObjectCommand,
  type GetObjectCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  type PutObjectCommandOutput,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { ServiceUnavailableException } from '@nestjs/common'
import { type ChangeBlobRow, ChangeContentStore, changeBlobKey } from '@dltech/atlas-control'
import { EnvService } from '../../_core/config/env/env.service'

export interface ChangesS3Settings {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export interface ChangesS3Gateway {
  list(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput>
  put(command: PutObjectCommand): Promise<PutObjectCommandOutput>
  read(command: GetObjectCommand): Promise<GetObjectCommandOutput>
  remove(command: DeleteObjectsCommand): Promise<DeleteObjectsCommandOutput>
  signGet(args: { command: GetObjectCommand; ttlMs: number }): Promise<string>
}

const secondsOf = (ttlMs: number): number => Math.max(1, Math.floor(ttlMs / 1000))

export class ChangesAwsGateway implements ChangesS3Gateway {
  private readonly client: S3Client

  constructor(args: { settings: ChangesS3Settings }) {
    this.client = new S3Client({
      region: args.settings.region,
      endpoint: args.settings.endpoint,
      credentials: {
        accessKeyId: args.settings.accessKeyId,
        secretAccessKey: args.settings.secretAccessKey,
      },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }

  list(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput> {
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

  signGet(args: { command: GetObjectCommand; ttlMs: number }): Promise<string> {
    return getSignedUrl(this.client, args.command, { expiresIn: secondsOf(args.ttlMs) })
  }
}

const REMOVE_BATCH_SIZE = 1000

const LIST_PAGE_SIZE = 1000

const HASH_IN_KEY = /\/sha256\/[0-9a-f]{2}\/([0-9a-f]{64})$/

export type ChangesSettings = { settings: ChangesS3Settings; prefix: string }

type CredentialKey =
  | 'ARTIFACT_S3_ENDPOINT'
  | 'ARTIFACT_S3_REGION'
  | 'ARTIFACT_S3_ACCESS_KEY_ID'
  | 'ARTIFACT_S3_SECRET_ACCESS_KEY'

const requiredOf = (env: EnvService, key: CredentialKey): string => {
  const value = env.get(key)
  if (!value) throw new ServiceUnavailableException(`change storage is missing ${key}`)
  return value
}

export const changesSettingsOf = (env: EnvService): ChangesSettings => {
  const bucket = env.get('CHANGES_S3_BUCKET') ?? env.get('ARTIFACT_S3_BUCKET')
  if (!bucket) {
    throw new ServiceUnavailableException('change storage is missing CHANGES_S3_BUCKET')
  }
  return {
    settings: {
      endpoint: requiredOf(env, 'ARTIFACT_S3_ENDPOINT'),
      region: requiredOf(env, 'ARTIFACT_S3_REGION'),
      bucket,
      accessKeyId: requiredOf(env, 'ARTIFACT_S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredOf(env, 'ARTIFACT_S3_SECRET_ACCESS_KEY'),
    },
    prefix: env.get('CHANGES_S3_PREFIX') ?? 'worktree-changes',
  }
}

const isMissing = (error: unknown): boolean =>
  error instanceof S3ServiceException &&
  (error.$metadata.httpStatusCode === 404 || error.name === 'NoSuchKey')

export class S3ChangeContentStore extends ChangeContentStore {
  private readonly env: EnvService
  private readonly injected: ChangesS3Gateway | null
  private resolved: { gateway: ChangesS3Gateway; changes: ChangesSettings } | null = null

  constructor(args: { env: EnvService; gateway?: ChangesS3Gateway }) {
    super()
    this.env = args.env
    this.injected = args.gateway ?? null
  }

  private s3(): { gateway: ChangesS3Gateway; changes: ChangesSettings } {
    if (this.resolved === null) {
      const changes = changesSettingsOf(this.env)
      this.resolved = {
        changes,
        gateway: this.injected ?? new ChangesAwsGateway({ settings: changes.settings }),
      }
    }
    return this.resolved
  }

  private keyOf(hash: string): { bucket: string; key: string } {
    const { changes } = this.s3()
    return { bucket: changes.settings.bucket, key: changeBlobKey({ prefix: changes.prefix, hash }) }
  }

  async put(args: { hash: string; bytes: Uint8Array }): Promise<void> {
    const { gateway } = this.s3()
    const { bucket, key } = this.keyOf(args.hash)
    await gateway.put(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: args.bytes,
        ContentType: 'application/octet-stream',
      }),
    )
  }

  async read(args: { hash: string }): Promise<Uint8Array | null> {
    const { gateway } = this.s3()
    const { bucket, key } = this.keyOf(args.hash)
    try {
      const found = await gateway.read(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (found.Body === undefined) return null
      return new Uint8Array(await found.Body.transformToByteArray())
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async presignGet(args: { hash: string; ttlMs: number }): Promise<string> {
    const { gateway } = this.s3()
    const { bucket, key } = this.keyOf(args.hash)
    return gateway.signGet({
      command: new GetObjectCommand({ Bucket: bucket, Key: key }),
      ttlMs: args.ttlMs,
    })
  }

  async removing(hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) return
    const { gateway } = this.s3()
    const { changes } = this.s3()
    for (let start = 0; start < hashes.length; start += REMOVE_BATCH_SIZE) {
      const batch = hashes.slice(start, start + REMOVE_BATCH_SIZE)
      await gateway.remove(
        new DeleteCommand({
          Bucket: changes.settings.bucket,
          Delete: { Objects: batch.map((hash) => ({ Key: this.keyOf(hash).key })), Quiet: true },
        }),
      )
    }
  }

  async list(): Promise<readonly ChangeBlobRow[]> {
    const { gateway, changes } = this.s3()
    const found: ChangeBlobRow[] = []
    let token: string | undefined
    for (;;) {
      const page = await gateway.list(
        new ListObjectsV2Command({
          Bucket: changes.settings.bucket,
          Prefix: `${changes.prefix}/sha256/`,
          MaxKeys: LIST_PAGE_SIZE,
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
      )
      for (const object of page.Contents ?? []) {
        const match = object.Key === undefined ? null : HASH_IN_KEY.exec(object.Key)
        if (match === null || match[1] === undefined) continue
        found.push({
          hash: match[1],
          size: object.Size ?? 0,
          createdAt: object.LastModified?.getTime() ?? 0,
        })
      }
      if (page.IsTruncated !== true || page.NextContinuationToken === undefined) return found
      token = page.NextContinuationToken
    }
  }
}
